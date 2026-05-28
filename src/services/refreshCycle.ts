import { db } from "@/lib/db";
import { verifyContactsBulk } from "@/services/verification";
import { enrichContactsBulk } from "@/services/enrichment";
import { evaluateAndApplyBulk } from "@/services/gates";
import { checkBulkApproval } from "@/services/bulkApproval";

export type RefreshCycleInput = {
  /** null/undefined = all clients (cross-client refresh). */
  clientId?: string | null;
  maxContacts?: number;
  approvalId?: string;
  performAnonymisation?: boolean;
  actorUserId: string;
};

export type RefreshCycleResult = {
  refreshLogId: string;
  cycleNumber: number;
  startedAt: Date;
  completedAt: Date;
  durationSeconds: number;

  contactsProcessed: number;

  verification: {
    succeeded: number;
    failed: number;
    creditsByProvider: Record<string, number>;
  };
  enrichment: {
    enriched: number;
    noMatch: number;
    skipped: number;
    failed: number;
    conflictsFlagged: number;
    creditsByProvider: Record<string, number>;
  };
  gates: {
    promoted: number;
    downgraded: number;
    unchanged: number;
    quarantined: number;
  };
  anonymisation: {
    candidatesIdentified: number;
    anonymised: number;
  };

  costBreakdown: Array<{ provider: string; credits: number; eurCost: number }>;
  totalCostEur: number;

  errors?: Array<{ phase: string; message: string }>;
  pendingApprovalId?: string;
};

const PROVIDER_PRICING_EUR: Record<string, number> = {
  millionverifier: 0.005,
  bouncer: 0.007,
  cognism: 0.3,
  apollo: 0.25,
  cognism_diamond: 0.5,
  ai_sdr_platform: 0.0, // event writebacks are free
};

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function subDays(base: Date, days: number): Date {
  return addDays(base, -days);
}

function subMonths(base: Date, months: number): Date {
  const d = new Date(base);
  d.setMonth(d.getMonth() - months);
  return d;
}

function sumCredits(
  a: Record<string, number>,
  b: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

function computeCostBreakdown(
  creditsByProvider: Record<string, number>,
): { breakdown: RefreshCycleResult["costBreakdown"]; total: number } {
  const breakdown: RefreshCycleResult["costBreakdown"] = [];
  let total = 0;
  for (const [provider, credits] of Object.entries(creditsByProvider)) {
    const eurPerCredit = PROVIDER_PRICING_EUR[provider] ?? 0;
    const eurCost = credits * eurPerCredit;
    if (credits === 0) continue;
    breakdown.push({ provider, credits, eurCost });
    total += eurCost;
  }
  // Keep stable ordering for easier diffs/diagnostics.
  breakdown.sort((a, b) => b.eurCost - a.eurCost || a.provider.localeCompare(b.provider));
  return { breakdown, total };
}

export async function runRefreshCycle(
  input: RefreshCycleInput,
): Promise<RefreshCycleResult> {
  const now = new Date();
  const startedAt = now;
  const errors: Array<{ phase: string; message: string }> = [];

  const maxContacts = Math.max(0, input.maxContacts ?? 100);
  const performAnonymisation = input.performAnonymisation ?? true;

  if (input.approvalId) {
    const approval = await db.bulkActionApproval.findUnique({
      where: { id: input.approvalId },
      select: { status: true },
    });
    if (!approval || approval.status !== "approved") {
      throw new Error("Provided approvalId is not approved for execution.");
    }
  }

  if (maxContacts > 100 && !input.approvalId) {
    const approvalCheck = await checkBulkApproval({
      actionType: "bulk_refresh_cycle_run",
      recordsAffected: maxContacts,
      requestorId: input.actorUserId,
      clientId: input.clientId ?? undefined,
      requestPayload: {
        clientId: input.clientId ?? null,
        maxContacts,
        performAnonymisation,
      },
    });
    if (!approvalCheck.allowed) {
      return {
        refreshLogId: "",
        cycleNumber: 0,
        startedAt,
        completedAt: startedAt,
        durationSeconds: 0,
        contactsProcessed: 0,
        verification: { succeeded: 0, failed: 0, creditsByProvider: {} },
        enrichment: {
          enriched: 0,
          noMatch: 0,
          skipped: 0,
          failed: 0,
          conflictsFlagged: 0,
          creditsByProvider: {},
        },
        gates: { promoted: 0, downgraded: 0, unchanged: 0, quarantined: 0 },
        anonymisation: { candidatesIdentified: 0, anonymised: 0 },
        costBreakdown: [],
        totalCostEur: 0,
        pendingApprovalId: approvalCheck.pendingApprovalId,
      };
    }
  }

  // Determine scope.
  const isCrossClient = input.clientId == null;
  const requestedClientId = isCrossClient ? null : input.clientId;

  // Cycle numbering scope:
  // - same clientId: use max cycleNumber for that client
  // - cross-client: use global max cycleNumber
  const cycleScopeWhere = requestedClientId
    ? { clientId: requestedClientId }
    : {};

  const maxCycleAgg = await db.refreshLog.aggregate({
    where: cycleScopeWhere,
    _max: { cycleNumber: true },
  });
  const cycleNumber = (maxCycleAgg._max.cycleNumber ?? 0) + 1;

  const refreshLogClientId = requestedClientId
    ? requestedClientId
    : (
        await db.client.findFirst({
          orderBy: { createdAt: "asc" },
          select: { id: true },
        })
      )?.id ?? null;

  if (!refreshLogClientId) {
    throw new Error("No clients exist — cannot create refresh log row");
  }

  const refreshLog = await db.refreshLog.create({
    data: {
      clientId: refreshLogClientId,
      cycleNumber,
      startedAt,
      status: "in_progress",
      recordsReVerified: 0,
      recordsDowngraded: 0,
      recordsAnonymised: 0,
      recordsGapFilled: 0,
    },
  });

  const refreshLogId = refreshLog.id;

  // Initialize counters.
  const contactsProcessed = 0; // placeholder for TS; set after selection.
  let selectedContactIds: string[] = [];
  let contactsProcessedFinal = 0;

  let verification = {
    succeeded: 0,
    failed: 0,
    creditsByProvider: {} as Record<string, number>,
  };

  let enrichment = {
    enriched: 0,
    noMatch: 0,
    skipped: 0,
    failed: 0,
    conflictsFlagged: 0,
    creditsByProvider: {} as Record<string, number>,
  };

  let gates = {
    promoted: 0,
    downgraded: 0,
    unchanged: 0,
    quarantined: 0,
  };

  let anonymisation = {
    candidatesIdentified: 0,
    anonymised: 0,
  };

  try {
    // ---- Identify stale gate_2 contacts ----
    const where = {
      gateStatus: "gate_2",
      mergedIntoId: null,
      lifecycleStage: "active",
      ...(requestedClientId ? { clientId: requestedClientId } : {}),
    };

    // Prisma/SQLite ordering of NULLs can vary; the demo is fine, but we
    // still aim for "nulls first then oldest".
    const raw = await db.contact.findMany({
      where,
      select: { id: true, lastVerifiedAt: true },
      orderBy: { lastVerifiedAt: "asc" },
      take: maxContacts,
    });
    raw.sort((a, b) => {
      if (a.lastVerifiedAt === null && b.lastVerifiedAt !== null) return -1;
      if (a.lastVerifiedAt !== null && b.lastVerifiedAt === null) return 1;
      if (a.lastVerifiedAt === null && b.lastVerifiedAt === null) return 0;
      return a.lastVerifiedAt!.getTime() - b.lastVerifiedAt!.getTime();
    });

    selectedContactIds = raw.map((r) => r.id);
    contactsProcessedFinal = selectedContactIds.length;

    // ---- Verification ----
    if (selectedContactIds.length > 0) {
      try {
        const verificationResult = await verifyContactsBulk(
          selectedContactIds,
          {
            actorUserId: input.actorUserId,
            emailWaterfall: true,
            batchId: refreshLogId,
          },
        );
        verification = {
          succeeded: verificationResult.succeeded,
          failed: verificationResult.failed,
          creditsByProvider: verificationResult.creditsByProvider,
        };
      } catch (e) {
        errors.push({
          phase: "verification",
          message: e instanceof Error ? e.message : String(e),
        });
        verification = {
          succeeded: 0,
          failed: selectedContactIds.length,
          creditsByProvider: {},
        };
      }

      // ---- Enrichment ----
      try {
        const enrichmentResult = await enrichContactsBulk(selectedContactIds, {
          actorUserId: input.actorUserId,
          batchId: refreshLogId,
        });
        enrichment = {
          enriched: enrichmentResult.enriched,
          noMatch: enrichmentResult.noMatch,
          skipped: enrichmentResult.skipped,
          failed: enrichmentResult.failed,
          conflictsFlagged: enrichmentResult.conflictsFlagged,
          creditsByProvider: enrichmentResult.creditsByProvider,
        };
      } catch (e) {
        errors.push({
          phase: "enrichment",
          message: e instanceof Error ? e.message : String(e),
        });
        enrichment = {
          enriched: 0,
          noMatch: 0,
          skipped: 0,
          failed: selectedContactIds.length,
          conflictsFlagged: 0,
          creditsByProvider: {},
        };
      }

      // ---- Gate evaluation & apply ----
      try {
        const gateResult = await evaluateAndApplyBulk(
          selectedContactIds,
          input.actorUserId,
        );
        gates = {
          promoted: gateResult.promoted,
          downgraded: gateResult.downgraded,
          unchanged: gateResult.unchanged,
          quarantined: gateResult.quarantined,
        };
      } catch (e) {
        errors.push({
          phase: "gates",
          message: e instanceof Error ? e.message : String(e),
        });
        gates = {
          promoted: 0,
          downgraded: 0,
          unchanged: selectedContactIds.length,
          quarantined: 0,
        };
      }
    }

    // ---- Anonymisation (best effort) ----
    if (performAnonymisation) {
      const now = new Date();
      const cutoff13Months = subMonths(now, 13);
      const cutoff365Days = subDays(now, 365);

      const baseWhere = {
        mergedIntoId: null,
        ...(requestedClientId ? { clientId: requestedClientId } : {}),
        OR: [
          {
            lifecycleStage: "frozen",
            updatedAt: { lt: cutoff13Months },
          },
          {
            lifecycleStage: "active",
            gateStatus: "gate_0",
            OR: [
              { lastVerifiedAt: { lt: cutoff365Days } },
              {
                lastVerifiedAt: null,
                createdAt: { lt: cutoff365Days },
              },
            ],
          },
        ],
      };

      const candidateContacts = await db.contact.findMany({
        where: baseWhere,
        select: { id: true, personId: true, clientId: true },
        orderBy: { createdAt: "asc" },
      });

      anonymisation.candidatesIdentified = candidateContacts.length;
      const toAnonymise = candidateContacts.slice(0, 20);
      anonymisation.anonymised = toAnonymise.length;

      if (toAnonymise.length > 0) {
        await db.$transaction(async (tx) => {
          for (const c of toAnonymise) {
            await tx.contact.update({
              where: { id: c.id },
              data: {
                email: null,
                phone: null,
                lifecycleStage: "anonymised",
              },
            });
            await tx.person.update({
              where: { id: c.personId },
              data: {
                primaryEmail: null,
                primaryPhone: null,
                linkedinUrl: null,
                fullName: "ANONYMISED",
                firstName: null,
                lastName: null,
                inferredGender: null,
              },
            });
          }
        });

        await db.auditLog.create({
          data: {
            clientId: toAnonymise[0]!.clientId,
            actorUserId: input.actorUserId,
            action: "contacts_anonymised",
            resourceType: "contacts_anonymised_batch",
            resourceId: refreshLogId,
            recordsAffected: toAnonymise.length,
            afterState: JSON.stringify({
              contactIds: toAnonymise.map((c) => c.id),
              cutoff13Months: cutoff13Months.toISOString(),
              cutoff365Days: cutoff365Days.toISOString(),
              maxCap: 20,
            }),
          },
        });
      }
    }
  } catch (e) {
    errors.push({
      phase: "orchestrator",
      message: e instanceof Error ? e.message : String(e),
    });
    // If we can't even select the contacts, fail fast.
    await db.refreshLog.update({
      where: { id: refreshLogId },
      data: { status: "failed", completedAt: new Date() },
    });
    throw e;
  }

  // ---- Cost computation ----
  const mergedCredits = sumCredits(
    verification.creditsByProvider ?? {},
    enrichment.creditsByProvider ?? {},
  );
  const { breakdown, total } = computeCostBreakdown(mergedCredits);

  const completedAt = new Date();
  const durationSeconds = Math.max(
    0,
    Math.round((completedAt.getTime() - startedAt.getTime()) / 1000),
  );

  const fullResult: RefreshCycleResult = {
    refreshLogId,
    cycleNumber,
    startedAt,
    completedAt,
    durationSeconds,
    contactsProcessed: contactsProcessedFinal,
    verification,
    enrichment,
    gates,
    anonymisation,
    costBreakdown: breakdown,
    totalCostEur: total,
    ...(errors.length ? { errors } : {}),
  };

  // ---- Update refresh_log + master audit log ----
  await db.refreshLog.update({
    where: { id: refreshLogId },
    data: {
      status: "completed",
      completedAt,
      recordsReVerified: contactsProcessedFinal,
      recordsDowngraded: gates.downgraded,
      recordsAnonymised: anonymisation.anonymised,
      recordsGapFilled: 0,
      costEstimate: total,
      notes: JSON.stringify({
        ...fullResult,
        // Explicitly capture credit→EUR mapping for traceability.
        PROVIDER_PRICING_EUR,
      }),
    },
  });

  await db.auditLog.create({
    data: {
      clientId: refreshLogClientId,
      actorUserId: input.actorUserId,
      action: "refresh_cycle_completed",
      resourceType: "refresh_log",
      resourceId: refreshLogId,
      recordsAffected: contactsProcessedFinal,
      afterState: JSON.stringify(fullResult),
    },
  });

  return fullResult;
}

