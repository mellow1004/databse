/**
 * Enrichment service with PRD Module 3 conflict resolution
 * (Phase 4, Step 4.3).
 *
 * For each contact we call BOTH enrichers (Cognism + Apollo) — we need both
 * responses to detect conflicts. The 4-step resolution rule (PRD Section 6,
 * Module 3) is applied per field:
 *
 *   1. Manual override lock — if Contact.manualOverrideUntil > now, the entire
 *      contact is skipped. No log rows, no field updates.
 *   2. Primary-by-market — Cognism wins for GB/Nordics/DACH, Apollo wins for
 *      North America, Cognism by default for everything else.
 *   3. Confidence-delta — when both providers match and disagree on a field
 *      with |confidencePrimary - confidenceSecondary| < 0.15 we DO NOT
 *      auto-resolve; instead we write a conflict_pending row to
 *      enrichment_log and surface the field for manual review.
 *   4. Otherwise — use primary's value when both match (with delta ≥ 0.15);
 *      use whichever matched when only one did.
 *
 * Gate promotion off the back of enrichment is intentionally NOT in scope —
 * that lives in 4.4. This service is purely the data-plane producer.
 */

import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { apollo, cognism } from "@/providers";
import { captureSnapshot } from "@/services/snapshots";
import type {
  Enricher,
  EnrichmentInput,
  EnrichmentResult,
} from "@/providers/types";

const CONFLICT_PROVIDER_LABEL = "conflict_detector";

// ============================================================
// Public types
// ============================================================

export type EnrichmentOptions = {
  batchId?: string;
  actorUserId: string;
};

export type EnrichmentOutcome = {
  contactId: string;
  status: "enriched" | "no_match" | "skipped_manual_override" | "error";
  fieldsUpdated: string[];
  fieldsConflicted: string[];
  providerCalls: Array<{
    provider: string;
    matched: boolean;
    confidence: number;
    creditsUsed: number;
  }>;
  totalCreditsUsed: number;
  errors: string[];
};

export type BulkEnrichmentResult = {
  batchId: string;
  total: number;
  enriched: number;
  noMatch: number;
  skipped: number;
  failed: number;
  outcomes: EnrichmentOutcome[];
  creditsByProvider: Record<string, number>;
  conflictsFlagged: number;
};

// ============================================================
// Constants — schema-aware field maps
// ============================================================

const CONTACT_FIELDS = ["title", "seniority", "phone"] as const;
const COMPANY_FIELDS = ["industry", "country", "headcountBand"] as const;
type EnrichableField =
  | (typeof CONTACT_FIELDS)[number]
  | (typeof COMPANY_FIELDS)[number];

const ALL_FIELDS: readonly EnrichableField[] = [
  ...CONTACT_FIELDS,
  ...COMPANY_FIELDS,
];

const CONFIDENCE_DELTA_THRESHOLD = 0.15;

// ============================================================
// Per-field decision logic (pure)
// ============================================================

type FieldDecision =
  | { kind: "skip" }
  | { kind: "conflict" }
  | { kind: "force_update"; value: string }
  | { kind: "update_if_null"; value: string };

function decideField(
  field: EnrichableField,
  primary: EnrichmentResult,
  secondary: EnrichmentResult,
): FieldDecision {
  const pVal = (primary.fields[field] ?? null) as string | null;
  const sVal = (secondary.fields[field] ?? null) as string | null;
  const pHas = primary.matched && pVal !== null;
  const sHas = secondary.matched && sVal !== null;

  if (!pHas && !sHas) return { kind: "skip" };
  if (pHas && !sHas) return { kind: "force_update", value: pVal! };
  if (!pHas && sHas) return { kind: "force_update", value: sVal! };
  if (pVal === sVal) return { kind: "update_if_null", value: pVal! };

  const delta = Math.abs(primary.confidence - secondary.confidence);
  if (delta < CONFIDENCE_DELTA_THRESHOLD) return { kind: "conflict" };
  return { kind: "force_update", value: pVal! };
}

// ============================================================
// Primary-by-market routing
// ============================================================

function pickPrimaryProvider(country: string | null): {
  primary: Enricher;
  secondary: Enricher;
} {
  if (country && apollo.primaryMarkets.includes(country)) {
    return { primary: apollo, secondary: cognism };
  }
  return { primary: cognism, secondary: apollo };
}

// ============================================================
// Single-contact entry point
// ============================================================

export async function enrichContact(
  contactId: string,
  options: EnrichmentOptions,
): Promise<EnrichmentOutcome> {
  const contact = await db.contact.findUnique({
    where: { id: contactId },
    include: {
      person: true,
      company: true,
    },
  });
  if (!contact) throw new Error(`contact ${contactId} not found`);
  if (contact.mergedIntoId !== null) {
    throw new Error(`contact ${contactId} is soft-archived (mergedIntoId set) — cannot enrich`);
  }

  // ---- Step 1: manual override lock ----
  const now = new Date();
  if (
    contact.manualOverrideUntil !== null &&
    contact.manualOverrideUntil.getTime() > now.getTime()
  ) {
    return {
      contactId,
      status: "skipped_manual_override",
      fieldsUpdated: [],
      fieldsConflicted: [],
      providerCalls: [],
      totalCreditsUsed: 0,
      errors: [],
    };
  }

  const batchId = options.batchId ?? randomUUID();

  // ---- Step 2: primary-by-market routing ----
  const country = contact.company.country ?? null;
  const { primary, secondary } = pickPrimaryProvider(country);

  // ---- Build enrichment input + call BOTH enrichers ----
  const input: EnrichmentInput = {
    fullName: contact.person.fullName,
    email: contact.email ?? contact.person.primaryEmail ?? null,
    linkedinUrl: contact.person.linkedinUrl ?? null,
    companyName: contact.company.legalName,
    domain: contact.company.rootDomain,
    country,
  };

  const [primaryResult, secondaryResult] = await Promise.all([
    primary.enrichContact(input),
    secondary.enrichContact(input),
  ]);

  // ---- Per-field decisions ----
  const contactUpdates: Record<string, string> = {};
  const companyUpdates: Record<string, string> = {};
  const fieldsUpdated: string[] = [];
  const fieldsConflicted: string[] = [];

  // Pre-load current values for update_if_null gating.
  const currentValues: Record<EnrichableField, string | null> = {
    title: contact.title,
    seniority: contact.seniority,
    phone: contact.phone,
    industry: contact.company.industry,
    country: contact.company.country,
    headcountBand: contact.company.headcountBand,
  };

  for (const field of ALL_FIELDS) {
    const decision = decideField(field, primaryResult, secondaryResult);
    switch (decision.kind) {
      case "skip":
        continue;
      case "conflict":
        fieldsConflicted.push(field);
        continue;
      case "force_update": {
        const isContactField = (CONTACT_FIELDS as readonly string[]).includes(field);
        if (isContactField) contactUpdates[field] = decision.value;
        else companyUpdates[field] = decision.value;
        fieldsUpdated.push(field);
        break;
      }
      case "update_if_null": {
        if (currentValues[field] === null) {
          const isContactField = (CONTACT_FIELDS as readonly string[]).includes(field);
          if (isContactField) contactUpdates[field] = decision.value;
          else companyUpdates[field] = decision.value;
          fieldsUpdated.push(field);
        }
        break;
      }
    }
  }

  const anyMatched = primaryResult.matched || secondaryResult.matched;
  const outcomeStatus: EnrichmentOutcome["status"] = anyMatched ? "enriched" : "no_match";

  const contactPreWrite: Record<string, string | Date | null> = {
    lastEnrichedAt: contact.lastEnrichedAt,
    writeSource: contact.writeSource,
  };
  const contactRecord = contact as unknown as Record<string, unknown>;
  for (const key of Object.keys(contactUpdates)) {
    const value = contactRecord[key];
    contactPreWrite[key] =
      typeof value === "string" || value instanceof Date || value === null
        ? value
        : null;
  }
  const snapshotRecords: Array<{
    recordType: "contact" | "company";
    recordId: string;
    data: object;
  }> = [{ recordType: "contact", recordId: contact.id, data: contactPreWrite }];
  if (Object.keys(companyUpdates).length > 0) {
    const companyPreWrite: Record<string, string | null> = {};
    const companyRecord = contact.company as unknown as Record<string, unknown>;
    for (const key of Object.keys(companyUpdates)) {
      const value = companyRecord[key];
      companyPreWrite[key] = typeof value === "string" || value === null ? value : null;
    }
    snapshotRecords.push({
      recordType: "company",
      recordId: contact.companyId,
      data: companyPreWrite,
    });
  }
  await captureSnapshot({
    batchId,
    batchType: "enrichment",
    records: snapshotRecords,
  });

  // ---- Single transaction: log rows + field updates ----
  await db.$transaction(async (tx) => {
    // Primary provider row (step=1). We persist the materialised `fields` and
    // `matched` flag alongside the provider's outer raw response so the
    // conflict-resolution UI can recover the exact value each side proposed
    // without having to re-run the provider.
    await tx.enrichmentLog.create({
      data: {
        clientId: contact.clientId,
        contactId: contact.id,
        companyId: contact.companyId,
        batchId,
        provider: primary.name,
        step: 1,
        fieldsFilled: JSON.stringify(
          primaryResult.matched
            ? Object.entries(primaryResult.fields)
                .filter(([, v]) => v !== null && v !== undefined)
                .map(([k]) => k)
            : [],
        ),
        confidence: primaryResult.confidence,
        rawResponse: JSON.stringify({
          ...primaryResult.rawResponse,
          fields: primaryResult.fields,
          matched: primaryResult.matched,
          confidence: primaryResult.confidence,
        }),
        status: primaryResult.matched ? "success" : "no_match",
        creditsUsed: primaryResult.creditsUsed,
      },
    });

    // Secondary provider row (step=2)
    await tx.enrichmentLog.create({
      data: {
        clientId: contact.clientId,
        contactId: contact.id,
        companyId: contact.companyId,
        batchId,
        provider: secondary.name,
        step: 2,
        fieldsFilled: JSON.stringify(
          secondaryResult.matched
            ? Object.entries(secondaryResult.fields)
                .filter(([, v]) => v !== null && v !== undefined)
                .map(([k]) => k)
            : [],
        ),
        confidence: secondaryResult.confidence,
        rawResponse: JSON.stringify({
          ...secondaryResult.rawResponse,
          fields: secondaryResult.fields,
          matched: secondaryResult.matched,
          confidence: secondaryResult.confidence,
        }),
        status: secondaryResult.matched ? "success" : "no_match",
        creditsUsed: secondaryResult.creditsUsed,
      },
    });

    // Conflict_pending rows — one per disputed field.
    for (const field of fieldsConflicted) {
      await tx.enrichmentLog.create({
        data: {
          clientId: contact.clientId,
          contactId: contact.id,
          companyId: contact.companyId,
          batchId,
          provider: CONFLICT_PROVIDER_LABEL,
          step: 3,
          fieldsFilled: JSON.stringify([field]),
          confidence: Math.min(primaryResult.confidence, secondaryResult.confidence),
          rawResponse: JSON.stringify({
            field,
            primary: {
              provider: primary.name,
              value: primaryResult.fields[field as keyof typeof primaryResult.fields] ?? null,
              confidence: primaryResult.confidence,
            },
            secondary: {
              provider: secondary.name,
              value: secondaryResult.fields[field as keyof typeof secondaryResult.fields] ?? null,
              confidence: secondaryResult.confidence,
            },
            delta: Math.abs(primaryResult.confidence - secondaryResult.confidence),
          }),
          status: "conflict_pending",
          creditsUsed: 0,
        },
      });
    }

    // Contact updates — always write lastEnrichedAt + writeSource, even on no_match.
    await tx.contact.update({
      where: { id: contact.id },
      data: {
        ...contactUpdates,
        lastEnrichedAt: now,
        writeSource: primary.name,
      },
    });

    if (Object.keys(companyUpdates).length > 0) {
      await tx.company.update({
        where: { id: contact.companyId },
        data: companyUpdates,
      });
    }
  });

  return {
    contactId,
    status: outcomeStatus,
    fieldsUpdated,
    fieldsConflicted,
    providerCalls: [
      {
        provider: primary.name,
        matched: primaryResult.matched,
        confidence: primaryResult.confidence,
        creditsUsed: primaryResult.creditsUsed,
      },
      {
        provider: secondary.name,
        matched: secondaryResult.matched,
        confidence: secondaryResult.confidence,
        creditsUsed: secondaryResult.creditsUsed,
      },
    ],
    totalCreditsUsed: primaryResult.creditsUsed + secondaryResult.creditsUsed,
    errors: [],
  };
}

// ============================================================
// Bulk entry point
// ============================================================

export async function enrichContactsBulk(
  contactIds: string[],
  options: EnrichmentOptions,
): Promise<BulkEnrichmentResult> {
  const batchId = options.batchId ?? randomUUID();
  const outcomes: EnrichmentOutcome[] = [];
  let enriched = 0;
  let noMatch = 0;
  let skipped = 0;
  let failed = 0;
  let conflictsFlagged = 0;
  let firstClientIdSeen: string | null = null;

  for (let i = 0; i < contactIds.length; i++) {
    const id = contactIds[i]!;
    if (i > 0 && i % 500 === 0) {
      console.log(`Checkpoint at ${i}/${contactIds.length}`);
    }
    try {
      const outcome = await enrichContact(id, { ...options, batchId });
      outcomes.push(outcome);
      if (outcome.status === "enriched") enriched += 1;
      else if (outcome.status === "no_match") noMatch += 1;
      else if (outcome.status === "skipped_manual_override") skipped += 1;
      else failed += 1;
      conflictsFlagged += outcome.fieldsConflicted.length;

      if (firstClientIdSeen === null) {
        const c = await db.contact.findUnique({
          where: { id },
          select: { clientId: true },
        });
        firstClientIdSeen = c?.clientId ?? null;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outcomes.push({
        contactId: id,
        status: "error",
        fieldsUpdated: [],
        fieldsConflicted: [],
        providerCalls: [],
        totalCreditsUsed: 0,
        errors: [message],
      });
      failed += 1;
    }
  }

  // Credit tally from the rows actually persisted under this batch.
  const creditRows = await db.enrichmentLog.groupBy({
    by: ["provider"],
    where: { batchId },
    _sum: { creditsUsed: true },
  });
  const creditsByProvider: Record<string, number> = {};
  for (const r of creditRows) {
    // Conflict rows are an internal accounting artefact, not a provider call.
    if (r.provider === CONFLICT_PROVIDER_LABEL) continue;
    creditsByProvider[r.provider] = r._sum.creditsUsed ?? 0;
  }

  await db.auditLog.create({
    data: {
      clientId: firstClientIdSeen,
      actorUserId: options.actorUserId,
      action: "enrichment_batch_completed",
      resourceType: "enrichment_batch",
      resourceId: batchId,
      batchId,
      recordsAffected: enriched + noMatch,
      afterState: JSON.stringify({
        total: contactIds.length,
        enriched,
        noMatch,
        skipped,
        failed,
        conflictsFlagged,
        creditsByProvider,
      }),
    },
  });

  return {
    batchId,
    total: contactIds.length,
    enriched,
    noMatch,
    skipped,
    failed,
    outcomes,
    creditsByProvider,
    conflictsFlagged,
  };
}
