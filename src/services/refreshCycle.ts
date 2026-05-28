import { db } from "@/lib/db";
import { verifyContact } from "@/services/verification";
import { enrichContact } from "@/services/enrichment";
import { applyGateDecision, evaluateContact } from "@/services/gates";
import { checkBulkApproval } from "@/services/bulkApproval";

export type RefreshCycleInput = {
  /** null/undefined = all clients (cross-client refresh). */
  clientId?: string | null;
  maxContacts?: number;
  maxActiveContacts?: number;
  maxDormantContacts?: number;
  maxFrozenContacts?: number;
  approvalId?: string;
  performAnonymisation?: boolean;
  actorUserId: string;
};

export type RefreshCyclePreview = {
  scope: {
    active: number;
    dormant: number;
    frozen: number;
    total: number;
  };
  estimatedCreditsByProvider: Record<string, number>;
  estimatedCostEur: number;
  tierActions: {
    active: string;
    dormant: string;
    frozen: string;
  };
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

type RefreshProgressNotes = {
  checkpoints: Array<{ at: number; total: number; timestamp: string }>;
  failedRecords: string[];
  skippedRecords: Array<{ contactId: string; reason: string }>;
  providerOutages: Array<{ provider: string; durationMs: number }>;
  providerCalls: Record<string, number>;
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

  const requestedMax = Math.max(0, input.maxContacts ?? 100);
  const maxActiveContacts = Math.max(
    0,
    input.maxActiveContacts ?? input.maxContacts ?? 100,
  );
  const maxDormantContacts = Math.max(
    0,
    input.maxDormantContacts ?? Math.max(25, Math.floor(requestedMax / 2)),
  );
  const maxFrozenContacts = Math.max(
    0,
    input.maxFrozenContacts ?? Math.max(25, Math.floor(requestedMax / 2)),
  );
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

  if (maxActiveContacts + maxDormantContacts > 100 && !input.approvalId) {
    const approvalCheck = await checkBulkApproval({
      actionType: "bulk_refresh_cycle_run",
      recordsAffected: maxActiveContacts + maxDormantContacts,
      requestorId: input.actorUserId,
      clientId: input.clientId ?? undefined,
      requestPayload: {
        clientId: input.clientId ?? null,
        maxActiveContacts,
        maxDormantContacts,
        maxFrozenContacts,
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

  let contactsProcessedFinal = 0;
  let activeContactIds: string[] = [];
  let dormantContactIds: string[] = [];
  let frozenContactIds: string[] = [];

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

  const progress: RefreshProgressNotes = {
    checkpoints: [],
    failedRecords: [],
    skippedRecords: [],
    providerOutages: [],
    providerCalls: {},
  };

  const checkpointEvery = 500;

  const writeProgress = async () => {
    await db.refreshLog.update({
      where: { id: refreshLogId },
      data: {
        notes: JSON.stringify(progress),
      },
    });
  };

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  async function resolveBudgetRow(provider: string, clientId: string | null) {
    const rows = await db.providerBudget.findMany({
      where: {
        provider,
        periodType: "monthly",
        status: "active",
        periodStart: { lte: now },
        periodEnd: { gt: now },
        OR: [{ clientId }, { clientId: null }],
      },
      orderBy: [{ clientId: "desc" }, { periodStart: "desc" }],
      take: 1,
    });
    return rows[0] ?? null;
  }

  async function canSpendProvider(
    provider: string,
    clientId: string | null,
    estimatedCredits: number,
  ): Promise<{ allowed: boolean; reason?: string }> {
    const budgetRow = await resolveBudgetRow(provider, clientId);
    if (!budgetRow) return { allowed: true };
    const estCost = estimatedCredits * (PROVIDER_PRICING_EUR[provider] ?? 0);
    if (budgetRow.spentEur + estCost > budgetRow.budgetEur) {
      return {
        allowed: false,
        reason: `${provider} monthly budget exhausted`,
      };
    }
    return { allowed: true };
  }

  async function registerProviderSpend(
    provider: string,
    clientId: string | null,
    creditsUsed: number,
  ) {
    if (creditsUsed <= 0) return;
    const budgetRow = await resolveBudgetRow(provider, clientId);
    if (!budgetRow) return;
    const additionalEur = creditsUsed * (PROVIDER_PRICING_EUR[provider] ?? 0);
    const nextSpent = budgetRow.spentEur + additionalEur;
    const threshold = budgetRow.budgetEur * budgetRow.alertThreshold;
    await db.providerBudget.update({
      where: { id: budgetRow.id },
      data: {
        spentEur: nextSpent,
        creditsUsed: budgetRow.creditsUsed + creditsUsed,
        alertedAt:
          budgetRow.alertedAt == null && nextSpent >= threshold
            ? new Date()
            : budgetRow.alertedAt,
        status: nextSpent >= budgetRow.budgetEur ? "exhausted" : budgetRow.status,
      },
    });
  }

  function maybeCheckpoint() {
    if (
      contactsProcessedFinal > 0 &&
      contactsProcessedFinal % checkpointEvery === 0
    ) {
      progress.checkpoints.push({
        at: contactsProcessedFinal,
        total: activeContactIds.length + dormantContactIds.length + frozenContactIds.length,
        timestamp: new Date().toISOString(),
      });
    }
  }

  try {
    const staleVerifyCutoff = subDays(now, 90);
    const staleEnrichCutoff = subDays(now, 180);
    const activeWhere = {
      lifecycleStage: "active",
      mergedIntoId: null,
      gateStatus: "gate_2",
      OR: [{ lastVerifiedAt: null }, { lastVerifiedAt: { lt: staleVerifyCutoff } }],
      ...(requestedClientId ? { clientId: requestedClientId } : {}),
    };
    const dormantWhere = {
      lifecycleStage: "dormant",
      mergedIntoId: null,
      ...(requestedClientId ? { clientId: requestedClientId } : {}),
    };
    const frozenWhere = {
      lifecycleStage: "frozen",
      mergedIntoId: null,
      ...(requestedClientId ? { clientId: requestedClientId } : {}),
    };

    const [activeRows, dormantRows, frozenRows] = await Promise.all([
      db.contact.findMany({
        where: activeWhere,
        select: { id: true, clientId: true },
        orderBy: { lastVerifiedAt: "asc" },
        take: maxActiveContacts,
      }),
      db.contact.findMany({
        where: dormantWhere,
        select: { id: true, clientId: true, lastVerifiedAt: true, lastEnrichedAt: true },
        orderBy: { lastCampaignAt: "asc" },
        take: maxDormantContacts,
      }),
      db.contact.findMany({
        where: frozenWhere,
        select: { id: true },
        orderBy: { lastCampaignAt: "asc" },
        take: maxFrozenContacts,
      }),
    ]);

    activeContactIds = activeRows.map((r) => r.id);
    dormantContactIds = dormantRows.map((r) => r.id);
    frozenContactIds = frozenRows.map((r) => r.id);

    for (const row of activeRows) {
      try {
        const verifyBudgetChecks = await Promise.all([
          canSpendProvider("millionverifier", row.clientId, 1),
          canSpendProvider("cognism_diamond", row.clientId, 1),
        ]);
        const verifyBlocked = verifyBudgetChecks.find((v) => !v.allowed);
        if (verifyBlocked) {
          verification.failed += 1;
          progress.skippedRecords.push({
            contactId: row.id,
            reason: verifyBlocked.reason ?? "verification budget exceeded",
          });
          errors.push({
            phase: "verification",
            message: `contact ${row.id}: ${verifyBlocked.reason ?? "budget exceeded"}`,
          });
          contactsProcessedFinal += 1;
          maybeCheckpoint();
          continue;
        }
        const verifyStarted = Date.now();
        const verifyOutcome = await verifyContact(row.id, {
          actorUserId: input.actorUserId,
          emailWaterfall: true,
          batchId: refreshLogId,
        });
        progress.providerOutages.push({
          provider: "verification",
          durationMs: Date.now() - verifyStarted,
        });
        verification.succeeded += 1;
        for (const [provider, credits] of Object.entries({
          millionverifier:
            verifyOutcome.emailVerification?.provider === "millionverifier"
              ? verifyOutcome.emailVerification.creditsUsed
              : 0,
          bouncer:
            verifyOutcome.emailVerification?.provider === "bouncer"
              ? verifyOutcome.emailVerification.creditsUsed
              : 0,
          cognism_diamond: verifyOutcome.phoneVerification?.creditsUsed ?? 0,
        })) {
          if (credits > 0) {
            verification.creditsByProvider[provider] =
              (verification.creditsByProvider[provider] ?? 0) + credits;
            progress.providerCalls[provider] =
              (progress.providerCalls[provider] ?? 0) + 1;
            await registerProviderSpend(provider, row.clientId, credits);
          }
        }
      } catch (e) {
        verification.failed += 1;
        progress.failedRecords.push(row.id);
        errors.push({
          phase: "verification",
          message: e instanceof Error ? e.message : String(e),
        });
      }
      try {
        const enrichBudgetChecks = await Promise.all([
          canSpendProvider("cognism", row.clientId, 1),
          canSpendProvider("apollo", row.clientId, 1),
        ]);
        const enrichBlocked = enrichBudgetChecks.find((v) => !v.allowed);
        if (enrichBlocked) {
          enrichment.failed += 1;
          progress.skippedRecords.push({
            contactId: row.id,
            reason: enrichBlocked.reason ?? "enrichment budget exceeded",
          });
        } else {
          const enrichStarted = Date.now();
          const enrichOutcome = await enrichContact(row.id, {
            actorUserId: input.actorUserId,
            batchId: refreshLogId,
          });
          progress.providerOutages.push({
            provider: "enrichment",
            durationMs: Date.now() - enrichStarted,
          });
          if (enrichOutcome.status === "enriched") enrichment.enriched += 1;
          else if (enrichOutcome.status === "no_match") enrichment.noMatch += 1;
          else if (enrichOutcome.status === "skipped_manual_override")
            enrichment.skipped += 1;
          else enrichment.failed += 1;
          enrichment.conflictsFlagged += enrichOutcome.fieldsConflicted.length;
          for (const call of enrichOutcome.providerCalls) {
            enrichment.creditsByProvider[call.provider] =
              (enrichment.creditsByProvider[call.provider] ?? 0) + call.creditsUsed;
            progress.providerCalls[call.provider] =
              (progress.providerCalls[call.provider] ?? 0) + 1;
            await registerProviderSpend(call.provider, row.clientId, call.creditsUsed);
          }
        }
      } catch (e) {
        enrichment.failed += 1;
        progress.failedRecords.push(row.id);
        errors.push({
          phase: "enrichment",
          message: e instanceof Error ? e.message : String(e),
        });
      }

      try {
        const evaluation = await evaluateContact(row.id);
        if (evaluation.decision === "no_change") {
          gates.unchanged += 1;
        } else {
          const gateResult = await applyGateDecision(evaluation, input.actorUserId);
          if (!gateResult.applied) {
            gates.unchanged += 1;
          } else if (evaluation.decision === "promote") {
            gates.promoted += 1;
          } else {
            gates.downgraded += 1;
            if (evaluation.reason === "bounce_detected") gates.quarantined += 1;
          }
        }
      } catch (e) {
        gates.unchanged += 1;
        errors.push({
          phase: "gates",
          message: e instanceof Error ? e.message : String(e),
        });
      }

      contactsProcessedFinal += 1;
      maybeCheckpoint();
    }

    for (const row of dormantRows) {
      try {
        const needsVerify =
          row.lastVerifiedAt == null || row.lastVerifiedAt < staleVerifyCutoff;
        const needsEnrich =
          row.lastEnrichedAt == null || row.lastEnrichedAt < staleEnrichCutoff;

        if (needsVerify) {
          const verifyBudgetChecks = await Promise.all([
            canSpendProvider("millionverifier", row.clientId, 1),
            canSpendProvider("cognism_diamond", row.clientId, 1),
          ]);
          const verifyBlocked = verifyBudgetChecks.find((v) => !v.allowed);
          if (verifyBlocked) {
            verification.failed += 1;
            progress.skippedRecords.push({
              contactId: row.id,
              reason: verifyBlocked.reason ?? "verification budget exceeded",
            });
          } else {
            const verifyOutcome = await verifyContact(row.id, {
              actorUserId: input.actorUserId,
              emailWaterfall: true,
              batchId: refreshLogId,
            });
            verification.succeeded += 1;
            if (verifyOutcome.emailVerification) {
              verification.creditsByProvider[verifyOutcome.emailVerification.provider] =
                (verification.creditsByProvider[verifyOutcome.emailVerification.provider] ?? 0) +
                verifyOutcome.emailVerification.creditsUsed;
              await registerProviderSpend(
                verifyOutcome.emailVerification.provider,
                row.clientId,
                verifyOutcome.emailVerification.creditsUsed,
              );
            }
            if (verifyOutcome.phoneVerification) {
              verification.creditsByProvider[verifyOutcome.phoneVerification.provider] =
                (verification.creditsByProvider[verifyOutcome.phoneVerification.provider] ?? 0) +
                verifyOutcome.phoneVerification.creditsUsed;
              await registerProviderSpend(
                verifyOutcome.phoneVerification.provider,
                row.clientId,
                verifyOutcome.phoneVerification.creditsUsed,
              );
            }
          }
        } else {
          progress.skippedRecords.push({
            contactId: row.id,
            reason: "dormant verification not due",
          });
        }

        if (needsEnrich) {
          const enrichBudgetChecks = await Promise.all([
            canSpendProvider("cognism", row.clientId, 1),
            canSpendProvider("apollo", row.clientId, 1),
          ]);
          const enrichBlocked = enrichBudgetChecks.find((v) => !v.allowed);
          if (enrichBlocked) {
            enrichment.failed += 1;
            progress.skippedRecords.push({
              contactId: row.id,
              reason: enrichBlocked.reason ?? "enrichment budget exceeded",
            });
          } else {
            const enrichOutcome = await enrichContact(row.id, {
              actorUserId: input.actorUserId,
              batchId: refreshLogId,
            });
            if (enrichOutcome.status === "enriched") enrichment.enriched += 1;
            else if (enrichOutcome.status === "no_match") enrichment.noMatch += 1;
            else if (enrichOutcome.status === "skipped_manual_override")
              enrichment.skipped += 1;
            else enrichment.failed += 1;
            enrichment.conflictsFlagged += enrichOutcome.fieldsConflicted.length;
            for (const call of enrichOutcome.providerCalls) {
              enrichment.creditsByProvider[call.provider] =
                (enrichment.creditsByProvider[call.provider] ?? 0) + call.creditsUsed;
              await registerProviderSpend(call.provider, row.clientId, call.creditsUsed);
            }
          }
        } else {
          progress.skippedRecords.push({
            contactId: row.id,
            reason: "dormant enrichment not due",
          });
        }
      } catch (e) {
        progress.failedRecords.push(row.id);
        errors.push({
          phase: "dormant_processing",
          message: e instanceof Error ? e.message : String(e),
        });
      }
      contactsProcessedFinal += 1;
      maybeCheckpoint();
    }

    for (const row of frozenRows) {
      progress.skippedRecords.push({
        contactId: row.id,
        reason: "frozen lifecycle stage requires manual reactivation",
      });
      contactsProcessedFinal += 1;
      maybeCheckpoint();
    }

    await writeProgress();

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
        progress,
        monthlyBudgetPeriod: {
          periodStart: monthStart.toISOString(),
          periodEnd: monthEnd.toISOString(),
        },
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

async function buildScope(
  input: Omit<RefreshCycleInput, "actorUserId">,
): Promise<{
  active: Array<{ id: string; clientId: string }>;
  dormant: Array<{
    id: string;
    clientId: string;
    lastVerifiedAt: Date | null;
    lastEnrichedAt: Date | null;
  }>;
  frozen: Array<{ id: string }>;
}> {
  const now = new Date();
  const staleVerifyCutoff = subDays(now, 90);
  const requestedClientId = input.clientId == null ? null : input.clientId;
  const maxActive = Math.max(0, input.maxActiveContacts ?? input.maxContacts ?? 100);
  const maxDormant = Math.max(
    0,
    input.maxDormantContacts ?? Math.max(25, Math.floor((input.maxContacts ?? 100) / 2)),
  );
  const maxFrozen = Math.max(
    0,
    input.maxFrozenContacts ?? Math.max(25, Math.floor((input.maxContacts ?? 100) / 2)),
  );

  const [active, dormant, frozen] = await Promise.all([
    db.contact.findMany({
      where: {
        lifecycleStage: "active",
        mergedIntoId: null,
        gateStatus: "gate_2",
        OR: [{ lastVerifiedAt: null }, { lastVerifiedAt: { lt: staleVerifyCutoff } }],
        ...(requestedClientId ? { clientId: requestedClientId } : {}),
      },
      select: { id: true, clientId: true },
      orderBy: { lastVerifiedAt: "asc" },
      take: maxActive,
    }),
    db.contact.findMany({
      where: {
        lifecycleStage: "dormant",
        mergedIntoId: null,
        ...(requestedClientId ? { clientId: requestedClientId } : {}),
      },
      select: { id: true, clientId: true, lastVerifiedAt: true, lastEnrichedAt: true },
      orderBy: { lastCampaignAt: "asc" },
      take: maxDormant,
    }),
    db.contact.findMany({
      where: {
        lifecycleStage: "frozen",
        mergedIntoId: null,
        ...(requestedClientId ? { clientId: requestedClientId } : {}),
      },
      select: { id: true },
      orderBy: { lastCampaignAt: "asc" },
      take: maxFrozen,
    }),
  ]);

  return { active, dormant, frozen };
}

export async function previewRefreshCycle(
  input: Omit<RefreshCycleInput, "actorUserId">,
): Promise<RefreshCyclePreview> {
  const now = new Date();
  const staleVerifyCutoff = subDays(now, 90);
  const staleEnrichCutoff = subDays(now, 180);
  const scope = await buildScope(input);

  const estimatedCreditsByProvider: Record<string, number> = {};
  const add = (provider: string, credits: number) => {
    estimatedCreditsByProvider[provider] =
      (estimatedCreditsByProvider[provider] ?? 0) + credits;
  };

  for (const _row of scope.active) {
    add("millionverifier", 1);
    add("cognism_diamond", 1);
    add("cognism", 1);
    add("apollo", 1);
  }

  for (const row of scope.dormant) {
    if (row.lastVerifiedAt == null || row.lastVerifiedAt < staleVerifyCutoff) {
      add("millionverifier", 1);
      add("cognism_diamond", 1);
    }
    if (row.lastEnrichedAt == null || row.lastEnrichedAt < staleEnrichCutoff) {
      add("cognism", 1);
      add("apollo", 1);
    }
  }

  const { total } = computeCostBreakdown(estimatedCreditsByProvider);

  return {
    scope: {
      active: scope.active.length,
      dormant: scope.dormant.length,
      frozen: scope.frozen.length,
      total: scope.active.length + scope.dormant.length + scope.frozen.length,
    },
    estimatedCreditsByProvider,
    estimatedCostEur: total,
    tierActions: {
      active: "Full pipeline: verification + enrichment + gates",
      dormant: "Conditional verify (>90d) and enrich (>180d), no gate changes",
      frozen: "Skipped entirely, requires manual reactivation",
    },
  };
}

