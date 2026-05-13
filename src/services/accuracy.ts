import { db } from "@/lib/db";

export type SampleDrawInput = {
  clientId: string;
  provider: string;
  cycleNumber: number;
  actorUserId: string;
};

export type SampleDrawOutput = {
  sampleId: string;
  provider: string;
  cycleNumber: number;
  populationSize: number;
  sampleSize: number;
  contactIds: string[];
};

export type SampleReviewInput = {
  sampleRowId: string;
  isCorrect: boolean;
  actualValue?: string;
  notes?: string;
  reviewerId: string;
};

export type AccuracyStats = {
  provider: string;
  cycleNumber: number;
  totalSampled: number;
  reviewed: number;
  correct: number;
  incorrect: number;
  pending: number;
  accuracyRate: number | null;
  alertLevel: "ok" | "investigation" | "demotion";
};

/** Parse enrichment_log.rawResponse for a non-empty title claim (fields.title or legacy title). */
export function extractClaimedTitle(rawResponse: string | null): string | null {
  if (!rawResponse) return null;
  try {
    const p = JSON.parse(rawResponse) as Record<string, unknown>;
    const fields = p.fields as Record<string, unknown> | undefined;
    if (fields && typeof fields.title === "string") {
      const t = fields.title.trim();
      if (t) return t;
    }
    if (typeof p.title === "string") {
      const t = p.title.trim();
      if (t) return t;
    }
  } catch {
    return null;
  }
  return null;
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function alertFromRate(rate: number | null): "ok" | "investigation" | "demotion" {
  if (rate === null) return "ok";
  if (rate >= 85) return "ok";
  if (rate >= 75) return "investigation";
  return "demotion";
}

/**
 * Draws a stratified random sample of gate_2 contacts that have a successful
 * enrichment row from `provider` carrying a non-empty title in rawResponse.
 */
export async function drawAccuracySample(input: SampleDrawInput): Promise<SampleDrawOutput> {
  const { clientId, provider, cycleNumber, actorUserId } = input;

  const logs = await db.enrichmentLog.findMany({
    where: {
      clientId,
      provider,
      status: "success",
      contactId: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, contactId: true, rawResponse: true },
  });

  const bestByContact = new Map<string, { enrichmentLogId: string; title: string }>();
  for (const row of logs) {
    if (!row.contactId) continue;
    if (bestByContact.has(row.contactId)) continue;
    const title = extractClaimedTitle(row.rawResponse);
    if (!title) continue;
    bestByContact.set(row.contactId, { enrichmentLogId: row.id, title });
  }

  const contactIds = Array.from(bestByContact.keys());
  if (contactIds.length === 0) {
    return {
      sampleId: `draw-${clientId}-${provider}-${cycleNumber}-${Date.now()}`,
      provider,
      cycleNumber,
      populationSize: 0,
      sampleSize: 0,
      contactIds: [],
    };
  }

  const eligibleContacts = await db.contact.findMany({
    where: {
      id: { in: contactIds },
      clientId,
      gateStatus: "gate_2",
      mergedIntoId: null,
    },
    select: { id: true },
  });
  const eligibleSet = new Set(eligibleContacts.map((c) => c.id));

  const population: { contactId: string; enrichmentLogId: string; title: string }[] = [];
  for (const [contactId, meta] of bestByContact) {
    if (!eligibleSet.has(contactId)) continue;
    population.push({
      contactId,
      enrichmentLogId: meta.enrichmentLogId,
      title: meta.title,
    });
  }

  const populationSize = population.length;
  let sampleSize: number;
  if (populationSize < 50) {
    sampleSize = populationSize;
  } else {
    sampleSize = Math.max(50, Math.min(200, Math.ceil(populationSize * 0.01)));
  }

  shuffleInPlace(population);
  const picked = population.slice(0, sampleSize);

  const sampleId = `draw-${clientId}-${provider}-${cycleNumber}-${Date.now()}`;

  await db.$transaction(async (tx) => {
    if (picked.length > 0) {
      await tx.accuracySample.createMany({
        data: picked.map((p) => ({
          clientId,
          provider,
          cycleNumber,
          contactId: p.contactId,
          enrichmentLogId: p.enrichmentLogId,
          fieldChecked: "title",
          expectedValue: p.title,
        })),
      });
    }

    await tx.auditLog.create({
      data: {
        clientId,
        actorUserId,
        action: "accuracy_sample_drawn",
        resourceType: "accuracy_sample",
        resourceId: sampleId,
        recordsAffected: picked.length,
        afterState: JSON.stringify({
          provider,
          cycleNumber,
          populationSize,
          sampleSize: picked.length,
          contactIds: picked.map((p) => p.contactId),
        }),
      },
    });
  });

  return {
    sampleId,
    provider,
    cycleNumber,
    populationSize,
    sampleSize: picked.length,
    contactIds: picked.map((p) => p.contactId),
  };
}

export async function recordSampleReview(input: SampleReviewInput): Promise<void> {
  const { sampleRowId, isCorrect, actualValue, notes, reviewerId } = input;
  const now = new Date();

  await db.$transaction(async (tx) => {
    const row = await tx.accuracySample.findUnique({
      where: { id: sampleRowId },
      select: { id: true, clientId: true, provider: true, cycleNumber: true, contactId: true },
    });
    if (!row) throw new Error(`AccuracySample ${sampleRowId} not found`);

    await tx.accuracySample.update({
      where: { id: sampleRowId },
      data: {
        reviewedAt: now,
        reviewerId,
        isCorrect,
        actualValue: actualValue?.trim() || null,
        notes: notes?.trim() || null,
      },
    });

    await tx.auditLog.create({
      data: {
        clientId: row.clientId,
        actorUserId: reviewerId,
        action: "accuracy_sample_reviewed",
        resourceType: "accuracy_sample",
        resourceId: sampleRowId,
        recordsAffected: 1,
        afterState: JSON.stringify({
          provider: row.provider,
          cycleNumber: row.cycleNumber,
          contactId: row.contactId,
          isCorrect,
          actualValue: actualValue?.trim() ?? null,
        }),
      },
    });
  });
}

/**
 * Aggregates all samples for a provider + cycle. Pass `clientId` to scope to
 * one tenant (used by the admin UI); omit to aggregate globally.
 */
export async function computeAccuracyStats(
  provider: string,
  cycleNumber: number,
  clientId?: string,
): Promise<AccuracyStats> {
  const where = {
    provider,
    cycleNumber,
    ...(clientId ? { clientId } : {}),
  };

  const rows = await db.accuracySample.findMany({
    where,
    select: { isCorrect: true, reviewedAt: true },
  });

  const totalSampled = rows.length;
  const reviewed = rows.filter((r) => r.reviewedAt !== null).length;
  const correct = rows.filter((r) => r.isCorrect === true).length;
  const incorrect = rows.filter((r) => r.isCorrect === false).length;
  const pending = rows.filter((r) => r.reviewedAt === null).length;

  const decided = correct + incorrect;
  const accuracyRate = decided === 0 ? null : (100 * correct) / decided;

  return {
    provider,
    cycleNumber,
    totalSampled,
    reviewed,
    correct,
    incorrect,
    pending,
    accuracyRate,
    alertLevel: alertFromRate(accuracyRate),
  };
}

/**
 * One stats row per distinct cycle (newest first), up to `limit` cycles.
 */
export async function computeAccuracyTrend(
  provider: string,
  clientId: string,
  limit = 10,
): Promise<AccuracyStats[]> {
  const rows = await db.accuracySample.findMany({
    where: { provider, clientId },
    select: { cycleNumber: true },
  });
  const cycles = [...new Set(rows.map((r) => r.cycleNumber))]
    .sort((a, b) => b - a)
    .slice(0, limit);

  const out: AccuracyStats[] = [];
  for (const cycleNumber of cycles) {
    out.push(await computeAccuracyStats(provider, cycleNumber, clientId));
  }
  return out;
}

/** Highest cycle number that has at least one sample for this client + provider. */
export async function maxAccuracyCycle(
  clientId: string,
  provider: string,
): Promise<number | null> {
  const agg = await db.accuracySample.aggregate({
    where: { clientId, provider },
    _max: { cycleNumber: true },
  });
  return agg._max.cycleNumber;
}
