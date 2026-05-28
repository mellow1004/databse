/**
 * Gate promotion engine — gate_1 ↔ gate_2 (Phase 4, Step 4.4).
 *
 * Evaluates a contact against the PRD-defined "campaign-ready trust floor"
 * (Section 7) and applies a state transition. Five binary checks compose the
 * floor:
 *
 *   1. structurallyComplete  — fullName + title + companyId all present
 *   2. emailDeliverable      — latest Verification of verificationType="email"
 *                              has status="valid"
 *   3. freshnessValid        — Contact.lastVerifiedAt within the last 90 days
 *   4. notQuarantined        — quarantineReason IS NULL
 *   5. notArchived           — mergedIntoId IS NULL
 *
 * Decision matrix:
 *
 *   - gate_1 + ALL pass                         → promote to gate_2
 *   - gate_2 + ANY of {1, 2, 3, 4} fail         → downgrade to gate_1
 *   - otherwise                                  → no_change
 *
 * Downgrade reason precedence (most-severe first):
 *
 *   bounce_detected   (criterion 2, latest email status = "invalid")
 *   completeness_lost (criterion 1)
 *   quarantined_state (criterion 4)
 *   freshness_expired (criterion 3)
 *   no_valid_email    (criterion 2 fails but not on "invalid" — e.g. risky / no
 *                      verification at all)
 *
 * Only the "bounce_detected" path also creates a QuarantineLog row and sets
 * Contact.quarantineReason = "bounce". Other downgrades leave quarantine
 * state untouched.
 */

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

const FRESHNESS_WINDOW_DAYS = 90;
const FRESHNESS_WINDOW_MS = FRESHNESS_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const DERIVED_FIELD_VERSION = "v1";

function quarantineApprovalPathFromReason(reasonCode: string): "auto" | "manual" {
  if (reasonCode === "stale") return "auto";
  return "manual";
}

// ============================================================
// Public types
// ============================================================

export type GateChecks = {
  structurallyComplete: boolean;
  emailDeliverable: boolean;
  freshnessValid: boolean;
  notQuarantined: boolean;
  notArchived: boolean;
};

export type GateDecision = "promote" | "downgrade" | "no_change";

export type GateEvaluation = {
  contactId: string;
  currentGate: string;
  proposedGate: string;
  decision: GateDecision;
  checks: GateChecks;
  reason: string | null;
  blockers: string[];
};

export type ApplyResult = {
  applied: boolean;
  fromGate: string;
  toGate: string;
  reason: string | null;
};

export type BulkGateResult = {
  total: number;
  promoted: number;
  downgraded: number;
  unchanged: number;
  quarantined: number;
  evaluations: GateEvaluation[];
};

// ============================================================
// Helpers
// ============================================================

function pickDowngradeReason(
  checks: GateChecks,
  latestEmailStatus: string | null,
): string {
  if (!checks.emailDeliverable && latestEmailStatus === "invalid") {
    return "bounce_detected";
  }
  if (!checks.structurallyComplete) return "completeness_lost";
  if (!checks.notQuarantined) return "quarantined_state";
  if (!checks.freshnessValid) return "freshness_expired";
  return "no_valid_email";
}

// ============================================================
// evaluateContact
// ============================================================

export async function evaluateContact(contactId: string): Promise<GateEvaluation> {
  const contact = await db.contact.findUnique({
    where: { id: contactId },
    include: { person: true },
  });
  if (!contact) throw new Error(`contact ${contactId} not found`);

  const latestEmail = await db.verification.findFirst({
    where: { contactId, verificationType: "email" },
    orderBy: { createdAt: "desc" },
    select: { status: true },
  });
  const latestEmailStatus = latestEmail?.status ?? null;

  const structurallyComplete =
    contact.person.fullName !== null &&
    contact.person.fullName.trim() !== "" &&
    contact.title !== null &&
    contact.title.trim() !== "" &&
    contact.companyId !== null;
  const emailDeliverable = latestEmailStatus === "valid";
  const freshnessValid =
    contact.lastVerifiedAt !== null &&
    Date.now() - contact.lastVerifiedAt.getTime() <= FRESHNESS_WINDOW_MS;
  const notQuarantined = contact.quarantineReason === null;
  const notArchived = contact.mergedIntoId === null;

  const checks: GateChecks = {
    structurallyComplete,
    emailDeliverable,
    freshnessValid,
    notQuarantined,
    notArchived,
  };
  const allPass = Object.values(checks).every((v) => v);
  const checks1To4Pass =
    structurallyComplete && emailDeliverable && freshnessValid && notQuarantined;

  const currentGate = contact.gateStatus;
  let decision: GateDecision = "no_change";
  let proposedGate = currentGate;
  let reason: string | null = null;
  const blockers: string[] = [];

  if (currentGate === "gate_1" && allPass) {
    decision = "promote";
    proposedGate = "gate_2";
    reason = "trust_floor_met";
  } else if (currentGate === "gate_2" && !checks1To4Pass) {
    decision = "downgrade";
    proposedGate = "gate_1";
    reason = pickDowngradeReason(checks, latestEmailStatus);
  } else if (currentGate === "gate_1") {
    // Surface every failing check so a UI / report can show "why".
    if (!structurallyComplete) blockers.push("structurallyComplete");
    if (!emailDeliverable) blockers.push("emailDeliverable");
    if (!freshnessValid) blockers.push("freshnessValid");
    if (!notQuarantined) blockers.push("notQuarantined");
    if (!notArchived) blockers.push("notArchived");
  }

  return {
    contactId,
    currentGate,
    proposedGate,
    decision,
    checks,
    reason,
    blockers,
  };
}

// ============================================================
// applyGateDecision
// ============================================================

export async function applyGateDecision(
  evaluation: GateEvaluation,
  actorUserId: string,
): Promise<ApplyResult> {
  if (evaluation.decision === "no_change") {
    return {
      applied: false,
      fromGate: evaluation.currentGate,
      toGate: evaluation.currentGate,
      reason: null,
    };
  }

  const isBounce =
    evaluation.decision === "downgrade" && evaluation.reason === "bounce_detected";

  await db.$transaction(async (tx) => {
    const contact = await tx.contact.findUnique({
      where: { id: evaluation.contactId },
      select: { clientId: true },
    });
    if (!contact) throw new Error(`contact ${evaluation.contactId} disappeared mid-apply`);

    const updates: Prisma.ContactUpdateInput = {
      gateStatus: evaluation.proposedGate,
      derivedFieldVersion: DERIVED_FIELD_VERSION,
    };
    if (isBounce) {
      updates.quarantineReason = "bounce";
    }
    await tx.contact.update({
      where: { id: evaluation.contactId },
      data: updates,
    });

    await tx.gateStatusHistory.create({
      data: {
        clientId: contact.clientId,
        contactId: evaluation.contactId,
        fromGate: evaluation.currentGate,
        toGate: evaluation.proposedGate,
        reason: evaluation.reason!,
        actor: actorUserId,
        derivedFieldVersion: DERIVED_FIELD_VERSION,
      },
    });

    if (isBounce) {
      const latest = await tx.verification.findFirst({
        where: { contactId: evaluation.contactId, verificationType: "email" },
        orderBy: { createdAt: "desc" },
        select: { provider: true, status: true },
      });
      await tx.quarantineLog.create({
        data: {
          clientId: contact.clientId,
          contactId: evaluation.contactId,
          reasonCode: "bounce",
          reasonDetail: latest
            ? `email verification provider=${latest.provider}, status=${latest.status}`
            : null,
          actor: actorUserId,
          reviewState: "pending",
          previousGate: evaluation.currentGate,
          proposedRestoredGate: evaluation.currentGate,
          approvalPath: quarantineApprovalPathFromReason("bounce"),
          approvalRequestedBy: null,
          approvalRequestedAt: null,
        },
      });
    }
  });

  return {
    applied: true,
    fromGate: evaluation.currentGate,
    toGate: evaluation.proposedGate,
    reason: evaluation.reason,
  };
}

// ============================================================
// evaluateAndApplyBulk
// ============================================================

export async function evaluateAndApplyBulk(
  contactIds: string[],
  actorUserId: string,
): Promise<BulkGateResult> {
  const evaluations: GateEvaluation[] = [];
  let promoted = 0;
  let downgraded = 0;
  let unchanged = 0;
  let quarantined = 0;
  let firstClientIdSeen: string | null = null;

  for (let i = 0; i < contactIds.length; i++) {
    const id = contactIds[i]!;
    if (i > 0 && i % 500 === 0) {
      console.log(`Checkpoint at ${i}/${contactIds.length}`);
    }
    const evaluation = await evaluateContact(id);
    evaluations.push(evaluation);

    if (firstClientIdSeen === null) {
      const c = await db.contact.findUnique({
        where: { id },
        select: { clientId: true },
      });
      firstClientIdSeen = c?.clientId ?? null;
    }

    if (evaluation.decision === "no_change") {
      unchanged += 1;
      continue;
    }
    const result = await applyGateDecision(evaluation, actorUserId);
    if (!result.applied) {
      unchanged += 1;
      continue;
    }
    if (evaluation.decision === "promote") {
      promoted += 1;
    } else if (evaluation.decision === "downgrade") {
      downgraded += 1;
      if (evaluation.reason === "bounce_detected") quarantined += 1;
    }
  }

  await db.auditLog.create({
    data: {
      clientId: firstClientIdSeen,
      actorUserId,
      action: "gate_evaluation_completed",
      resourceType: "gate_evaluation_batch",
      recordsAffected: promoted + downgraded,
      afterState: JSON.stringify({
        total: contactIds.length,
        promoted,
        downgraded,
        unchanged,
        quarantined,
      }),
    },
  });

  return {
    total: contactIds.length,
    promoted,
    downgraded,
    unchanged,
    quarantined,
    evaluations,
  };
}
