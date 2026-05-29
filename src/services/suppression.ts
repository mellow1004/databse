/**
 * Suppression enforcement service (Phase 5, Step 5.1).
 *
 * Encodes the three-scope rule from PRD Module 4 — global, client_level,
 * domain_level — plus the regulatory opt-out cooling period.
 *
 * Matching policy:
 *   - A suppression "matches" a contact when one of the following is true:
 *       * suppression.contactId === contact.id
 *       * suppression.email     === normalised(contact.email)
 *       * suppression.domain    ∈ { company.rootDomain, …aliasDomains }
 *   - A `client_level` suppression with all three identifiers null is a
 *     "broad-client" block: applies to every contact when the campaign is
 *     run for that suppression.clientId.
 *
 * Scope evaluation:
 *   - global          → matches always block
 *   - client_level    → matches block only when suppression.clientId equals
 *                       the campaign's clientId; broad-client variants apply
 *                       to every contact under that client
 *   - domain_level    → matches block regardless of the campaign client
 *
 * Opt-out (isOptOut === true) bypasses scope filtering entirely — a matched
 * opt-out blocks any client because the regulatory obligation transcends the
 * brand boundary. Cooling-period semantics:
 *   - coolingPeriodIndefinite === true                 → blocks forever
 *   - reviewRequiredBefore > now                       → blocks until then
 *   - reviewRequiredBefore <= now and !indefinite      → cooling expired,
 *                                                        no block
 *
 * Released suppressions (releaseStatus !== "active") are ignored.
 */

import { db } from "@/lib/db";
import { suppressionRequiresApproval } from "@/lib/suppression-governance";
import {
  normalizeDomain,
  normalizeEmail,
} from "@/lib/normalization";

export type SuppressionScope = "global" | "client_level" | "domain_level";

export type BlockingSuppression = {
  suppressionId: string;
  scope: SuppressionScope;
  reasonCode: string;
  isOptOut: boolean;
  coolingPeriodIndefinite: boolean;
  reviewRequiredBefore: Date | null;
};

export type SuppressionDecision = {
  contactId: string;
  targetable: boolean;
  blockingSuppressions: BlockingSuppression[];
};

// ============================================================
// Internal row shapes (subset of the Prisma model + DomainAlias)
// ============================================================

type SuppressionRow = {
  id: string;
  scope: string;
  clientId: string | null;
  contactId: string | null;
  email: string | null;
  domain: string | null;
  reasonCode: string;
  isOptOut: boolean;
  coolingPeriodIndefinite: boolean;
  reviewRequiredBefore: Date | null;
  releaseStatus: string;
};

type ContactWithCompany = {
  id: string;
  clientId: string;
  email: string | null;
  mergedIntoId: string | null;
  company: {
    id: string;
    rootDomain: string;
    domainAliases: { aliasDomain: string }[];
  };
};

// ============================================================
// Pure decision helpers
// ============================================================

function toBlocker(s: SuppressionRow): BlockingSuppression {
  return {
    suppressionId: s.id,
    scope: s.scope as SuppressionScope,
    reasonCode: s.reasonCode,
    isOptOut: s.isOptOut,
    coolingPeriodIndefinite: s.coolingPeriodIndefinite,
    reviewRequiredBefore: s.reviewRequiredBefore,
  };
}

function matchesIdentifiers(
  s: SuppressionRow,
  contactId: string,
  normalizedEmail: string | null,
  domains: Set<string>,
): boolean {
  if (s.contactId && s.contactId === contactId) return true;
  if (s.email && normalizedEmail && s.email === normalizedEmail) return true;
  if (s.domain && domains.has(s.domain)) return true;
  return false;
}

function isBroadClient(s: SuppressionRow): boolean {
  return s.contactId === null && s.email === null && s.domain === null;
}

function optOutStillActive(s: SuppressionRow, now: Date): boolean {
  if (s.coolingPeriodIndefinite) return true;
  if (s.reviewRequiredBefore && s.reviewRequiredBefore.getTime() > now.getTime()) {
    return true;
  }
  return false;
}

function evaluateOne(
  suppressions: SuppressionRow[],
  contact: ContactWithCompany,
  campaignClientId: string,
  now: Date,
): SuppressionDecision {
  const normalizedEmail = normalizeEmail(contact.email);
  const domains = new Set<string>([
    contact.company.rootDomain,
    ...contact.company.domainAliases.map((a) => a.aliasDomain),
  ]);

  const blockers: BlockingSuppression[] = [];
  for (const s of suppressions) {
    if (s.releaseStatus !== "active") continue;
    const matched = matchesIdentifiers(s, contact.id, normalizedEmail, domains);

    // OPT-OUT — regulatory; crosses scope boundaries.
    if (s.isOptOut) {
      if (!matched) continue;
      if (optOutStillActive(s, now)) blockers.push(toBlocker(s));
      continue;
    }

    // Non-opt-out — scope-specific.
    if (s.scope === "global") {
      if (matched) blockers.push(toBlocker(s));
    } else if (s.scope === "client_level") {
      if (s.clientId !== campaignClientId) continue;
      if (matched || isBroadClient(s)) blockers.push(toBlocker(s));
    } else if (s.scope === "domain_level") {
      // Domain-only scope: only the domain identifier carries weight.
      if (s.domain && domains.has(s.domain)) blockers.push(toBlocker(s));
    }
  }

  return {
    contactId: contact.id,
    targetable: blockers.length === 0,
    blockingSuppressions: blockers,
  };
}

// ============================================================
// Public API
// ============================================================

export async function evaluateContactSuppression(
  contactId: string,
  campaignClientId: string,
): Promise<SuppressionDecision> {
  const contact = await db.contact.findUnique({
    where: { id: contactId },
    select: {
      id: true,
      clientId: true,
      email: true,
      mergedIntoId: true,
      company: {
        select: {
          id: true,
          rootDomain: true,
          domainAliases: { select: { aliasDomain: true } },
        },
      },
    },
  });
  if (!contact) throw new Error(`contact ${contactId} not found`);
  if (contact.mergedIntoId !== null) {
    throw new Error(
      `contact ${contactId} is soft-archived (mergedIntoId set) — cannot evaluate suppression`,
    );
  }

  const suppressions = await db.suppression.findMany({
    where: { releaseStatus: "active" },
  });

  return evaluateOne(suppressions, contact, campaignClientId, new Date());
}

export async function evaluateBulkSuppression(
  contactIds: string[],
  campaignClientId: string,
): Promise<Map<string, SuppressionDecision>> {
  const result = new Map<string, SuppressionDecision>();
  if (contactIds.length === 0) return result;

  const [suppressions, contacts] = await Promise.all([
    db.suppression.findMany({ where: { releaseStatus: "active" } }),
    db.contact.findMany({
      where: { id: { in: contactIds }, mergedIntoId: null },
      select: {
        id: true,
        clientId: true,
        email: true,
        mergedIntoId: true,
        company: {
          select: {
            id: true,
            rootDomain: true,
            domainAliases: { select: { aliasDomain: true } },
          },
        },
      },
    }),
  ]);

  const now = new Date();
  for (const c of contacts) {
    result.set(c.id, evaluateOne(suppressions, c, campaignClientId, now));
  }
  return result;
}

export async function filterTargetableContacts(
  contactIds: string[],
  campaignClientId: string,
): Promise<string[]> {
  const decisions = await evaluateBulkSuppression(contactIds, campaignClientId);
  const out: string[] = [];
  for (const id of contactIds) {
    const d = decisions.get(id);
    if (d?.targetable) out.push(id);
  }
  return out;
}

// Exported for tests / future targeting query reuse.
export { normalizeDomain };

function buildContactMatchWhere(suppression: {
  scope: string;
  clientId: string | null;
  contactId: string | null;
  email: string | null;
  domain: string | null;
}): Record<string, unknown> | null {
  const base: Record<string, unknown> = { mergedIntoId: null };

  if (suppression.scope === "client_level") {
    if (!suppression.clientId) return null;
    base.clientId = suppression.clientId;
    if (!suppression.contactId && !suppression.email && !suppression.domain) {
      return base;
    }
  }

  const whereParts: Array<Record<string, unknown>> = [];
  if (suppression.contactId) whereParts.push({ id: suppression.contactId });
  if (suppression.email) whereParts.push({ email: suppression.email });
  if (suppression.domain) {
    whereParts.push({
      OR: [
        { company: { rootDomain: suppression.domain } },
        { company: { domainAliases: { some: { aliasDomain: suppression.domain } } } },
      ],
    });
  }

  if (suppression.scope === "domain_level") {
    if (!suppression.domain) return null;
    return {
      mergedIntoId: null,
      OR: [
        { company: { rootDomain: suppression.domain } },
        { company: { domainAliases: { some: { aliasDomain: suppression.domain } } } },
      ],
    };
  }

  if (whereParts.length === 0) {
    if (suppression.scope === "global") return { mergedIntoId: null };
    return null;
  }

  return { ...base, OR: whereParts };
}

async function computeAffectedClientCount(suppression: {
  scope: string;
  clientId: string | null;
  contactId: string | null;
  email: string | null;
  domain: string | null;
}): Promise<number> {
  if (suppression.scope === "client_level") return 1;

  const where = buildContactMatchWhere(suppression);
  if (!where) return 0;

  const rows = await db.contact.findMany({
    where,
    distinct: ["clientId"],
    select: { clientId: true },
  });
  return rows.length;
}

/** Approximate count of contacts that would match this suppression (not exact). */
export async function computeApproximateAffectedContactCount(suppression: {
  scope: string;
  clientId: string | null;
  contactId: string | null;
  email: string | null;
  domain: string | null;
}): Promise<number> {
  const where = buildContactMatchWhere(suppression);
  if (!where) return 0;
  return db.contact.count({ where });
}

export async function findContactIdsAffectedBySuppression(suppression: {
  scope: string;
  clientId: string | null;
  contactId: string | null;
  email: string | null;
  domain: string | null;
}): Promise<string[]> {
  const where = buildContactMatchWhere(suppression);
  if (!where) return [];
  const rows = await db.contact.findMany({
    where,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function getSuppressionReleaseScopeSummary(suppressionId: string): Promise<{
  summaryText: string;
  approximateContactCount: number;
  clientCount: number;
}> {
  const suppression = await db.suppression.findUnique({ where: { id: suppressionId } });
  if (!suppression) throw new Error(`Suppression ${suppressionId} not found.`);

  const approximateContactCount = await computeApproximateAffectedContactCount(suppression);

  if (suppression.scope === "client_level") {
    const client = suppression.clientId
      ? await db.client.findUnique({
          where: { id: suppression.clientId },
          select: { name: true },
        })
      : null;
    const clientName = client?.name ?? "Unknown client";
    return {
      summaryText: `Affects ${clientName}, ~${approximateContactCount} contacts in DB matching this suppression`,
      approximateContactCount,
      clientCount: 1,
    };
  }

  if (suppression.scope === "global") {
    const clientCount = await db.client.count();
    return {
      summaryText: `Affects all ${clientCount} clients, ~${approximateContactCount} contacts in DB matching`,
      approximateContactCount,
      clientCount,
    };
  }

  return {
    summaryText: `Affects all clients, ~${approximateContactCount} contacts at this domain`,
    approximateContactCount,
    clientCount: await computeAffectedClientCount(suppression),
  };
}

type ReleaseAuditExtras = {
  affectedContactCount: number;
  approverUserId: string;
  reason: string;
  regulatoryReviewReference?: string | null;
  confirmationChecked: boolean;
};

async function releaseSuppressionDirect(input: {
  suppressionId: string;
  actorUserId: string;
  releaseReason: string;
  auditExtras?: ReleaseAuditExtras;
}): Promise<void> {
  const suppression = await db.suppression.findUnique({ where: { id: input.suppressionId } });
  if (!suppression) throw new Error(`Suppression ${input.suppressionId} not found.`);
  if (suppression.releaseStatus === "released") return;

  const releasedAt = new Date();
  await db.$transaction(async (tx) => {
    await tx.suppression.update({
      where: { id: input.suppressionId },
      data: {
        releaseStatus: "released",
        releasedAt,
        releasedBy: input.actorUserId,
        releaseReason: input.releaseReason,
      },
    });
    await tx.auditLog.create({
      data: {
        clientId: suppression.clientId,
        actorUserId: input.actorUserId,
        action: "suppression_released",
        resourceType: "suppression",
        resourceId: suppression.id,
        recordsAffected: 1,
        afterState: JSON.stringify({
          releaseStatus: "released",
          reason: input.releaseReason,
          ...(input.auditExtras ?? {}),
        }),
      },
    });
  });
}

export async function requestSuppressionRelease(input: {
  suppressionId: string;
  reason: string;
  requestorId: string;
  regulatoryReviewReference?: string;
  confirmationChecked?: boolean;
}): Promise<{ status: "request_pending" | "released_directly" }> {
  const reason = input.reason.trim();
  if (!reason) throw new Error("A non-empty release reason is required.");

  const suppression = await db.suppression.findUnique({ where: { id: input.suppressionId } });
  if (!suppression) throw new Error(`Suppression ${input.suppressionId} not found.`);
  if (suppression.releaseStatus === "released") return { status: "released_directly" };

  const decision = suppressionRequiresApproval(suppression);
  if (decision.requiresApproval) {
    if (!input.confirmationChecked) {
      throw new Error("Regulatory compliance confirmation is required.");
    }
    if (suppression.isOptOut && !(input.regulatoryReviewReference ?? "").trim()) {
      throw new Error("Regulatory review reference is required for opt-out suppressions.");
    }
  }

  if (!decision.requiresApproval) {
    await releaseSuppressionDirect({
      suppressionId: input.suppressionId,
      actorUserId: input.requestorId,
      releaseReason: reason,
    });
    return { status: "released_directly" };
  }

  const [affectedClientCount, affectedContactCount] = await Promise.all([
    computeAffectedClientCount(suppression),
    computeApproximateAffectedContactCount(suppression),
  ]);
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.suppression.update({
      where: { id: input.suppressionId },
      data: {
        releaseStatus: "request_pending",
        releaseApprovalRequired: true,
        releaseRequestedBy: input.requestorId,
        releaseRequestedAt: now,
        releaseApprovalReason: reason,
        affectedClientCount,
      },
    });
    await tx.auditLog.create({
      data: {
        clientId: suppression.clientId,
        actorUserId: input.requestorId,
        action: "suppression_release_requested",
        resourceType: "suppression",
        resourceId: suppression.id,
        recordsAffected: 1,
        afterState: JSON.stringify({
          releaseStatus: "request_pending",
          reason,
          affectedClientCount,
          affectedContactCount,
          regulatoryReviewReference: input.regulatoryReviewReference?.trim() || null,
          confirmationChecked: true,
          requiresRegulatoryReview: decision.requiresRegulatoryReview,
        }),
      },
    });
  });
  return { status: "request_pending" };
}

export async function approveSuppressionRelease(input: {
  suppressionId: string;
  approverId: string;
  approvalReason: string;
  regulatoryReviewReference?: string;
  confirmationChecked?: boolean;
}): Promise<void> {
  const approvalReason = input.approvalReason.trim();
  if (!approvalReason) throw new Error("approvalReason is required.");
  if (!input.confirmationChecked) {
    throw new Error("Regulatory compliance confirmation is required.");
  }

  const suppression = await db.suppression.findUnique({ where: { id: input.suppressionId } });
  if (!suppression) throw new Error(`Suppression ${input.suppressionId} not found.`);
  if (suppression.releaseStatus !== "request_pending") {
    throw new Error("Suppression is not awaiting approval.");
  }
  if (suppression.isOptOut && !(input.regulatoryReviewReference ?? "").trim()) {
    throw new Error("Regulatory review reference is required for opt-out suppressions.");
  }

  const affectedContactCount = await computeApproximateAffectedContactCount(suppression);
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.suppression.update({
      where: { id: input.suppressionId },
      data: {
        releaseApprovedBy: input.approverId,
        releaseApprovedAt: now,
        releaseStatus: "released",
        releasedAt: now,
        releasedBy: input.approverId,
        releaseReason: approvalReason,
        ...(suppression.isOptOut
          ? {
              regulatoryReviewCompleted: true,
              regulatoryReviewBy: input.approverId,
              regulatoryReviewAt: now,
              regulatoryReviewNotes: (input.regulatoryReviewReference ?? "").trim(),
            }
          : {}),
      },
    });
    await tx.auditLog.create({
      data: {
        clientId: suppression.clientId,
        actorUserId: input.approverId,
        action: "suppression_release_approved",
        resourceType: "suppression",
        resourceId: suppression.id,
        recordsAffected: 1,
        afterState: JSON.stringify({
          releaseStatus: "released",
          approvalReason,
          reason: approvalReason,
          affectedContactCount,
          approverUserId: input.approverId,
          regulatoryReviewReference: input.regulatoryReviewReference?.trim() || null,
          confirmationChecked: true,
        }),
      },
    });
  });
}

export async function rejectSuppressionRelease(input: {
  suppressionId: string;
  actorUserId: string;
  rejectionReason: string;
}): Promise<void> {
  const rejectionReason = input.rejectionReason.trim();
  if (!rejectionReason) throw new Error("rejectionReason is required.");
  const suppression = await db.suppression.findUnique({ where: { id: input.suppressionId } });
  if (!suppression) throw new Error(`Suppression ${input.suppressionId} not found.`);
  if (suppression.releaseStatus !== "request_pending") {
    throw new Error("Suppression is not awaiting approval.");
  }

  await db.$transaction(async (tx) => {
    await tx.suppression.update({
      where: { id: input.suppressionId },
      data: {
        releaseStatus: "active",
        releaseApprovalRequired: false,
        releaseRequestedBy: null,
        releaseRequestedAt: null,
        releaseApprovalReason: null,
      },
    });
    await tx.auditLog.create({
      data: {
        clientId: suppression.clientId,
        actorUserId: input.actorUserId,
        action: "suppression_release_rejected",
        resourceType: "suppression",
        resourceId: suppression.id,
        recordsAffected: 1,
        afterState: JSON.stringify({ rejectionReason }),
      },
    });
  });
}
