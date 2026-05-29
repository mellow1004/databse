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
  alertLevel: "ok" | "investigation" | "demotion" | "insufficient_data";
};

const BASE_FIELDS = ["title", "company", "seniority"] as const;
type SampleField = (typeof BASE_FIELDS)[number] | "email" | "phone";

/** Parse enrichment_log.rawResponse for fields used in QA sampling. */
export function extractClaimedFields(rawResponse: string | null): Record<SampleField, string | null> {
  const empty: Record<SampleField, string | null> = {
    title: null,
    company: null,
    seniority: null,
    email: null,
    phone: null,
  };
  if (!rawResponse) return empty;
  try {
    const p = JSON.parse(rawResponse) as Record<string, unknown>;
    const fields = p.fields as Record<string, unknown> | undefined;
    if (fields) {
      const title = typeof fields.title === "string" ? fields.title.trim() : "";
      const company =
        typeof fields.company === "string"
          ? fields.company.trim()
          : typeof fields.companyName === "string"
            ? String(fields.companyName).trim()
            : "";
      const seniority = typeof fields.seniority === "string" ? fields.seniority.trim() : "";
      const email = typeof fields.email === "string" ? fields.email.trim() : "";
      const phone = typeof fields.phone === "string" ? fields.phone.trim() : "";
      if (title) empty.title = title;
      if (company) empty.company = company;
      if (seniority) empty.seniority = seniority;
      if (email) empty.email = email;
      if (phone) empty.phone = phone;
    }
    if (!empty.title && typeof p.title === "string") empty.title = p.title.trim() || null;
    if (!empty.seniority && typeof p.seniority === "string") {
      empty.seniority = p.seniority.trim() || null;
    }
  } catch {
    return empty;
  }
  return empty;
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

function alertFromStats(
  rate: number | null,
  reviewed: number,
): "ok" | "investigation" | "demotion" | "insufficient_data" {
  if (reviewed < 10) return "insufficient_data";
  return alertFromRate(rate);
}

/**
 * Draws a stratified random sample of gate_2 contacts that have a successful
 * enrichment row from `provider`, then creates one QA row per sampled field.
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

  const bestByContact = new Map<
    string,
    { enrichmentLogId: string; fields: Record<SampleField, string | null> }
  >();
  for (const row of logs) {
    if (!row.contactId) continue;
    if (bestByContact.has(row.contactId)) continue;
    const fields = extractClaimedFields(row.rawResponse);
    bestByContact.set(row.contactId, { enrichmentLogId: row.id, fields });
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
    select: { id: true, email: true, phone: true },
  });
  const eligibleById = new Map(eligibleContacts.map((c) => [c.id, c]));

  const population: Array<{
    contactId: string;
    enrichmentLogId: string;
    fields: Record<SampleField, string | null>;
    email: string | null;
    phone: string | null;
  }> = [];
  for (const [contactId, meta] of bestByContact) {
    const contact = eligibleById.get(contactId);
    if (!contact) continue;
    population.push({
      contactId,
      enrichmentLogId: meta.enrichmentLogId,
      fields: meta.fields,
      email: contact.email,
      phone: contact.phone,
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
      const sampleRows = picked.flatMap((p) => {
        const fields: SampleField[] = [...BASE_FIELDS];
        if (p.email) fields.push("email");
        if (p.phone) fields.push("phone");
        return fields.map((fieldChecked) => ({
          clientId,
          provider,
          cycleNumber,
          contactId: p.contactId,
          enrichmentLogId: p.enrichmentLogId,
          fieldChecked,
          expectedValue: p.fields[fieldChecked] ?? "",
        }));
      });
      await tx.accuracySample.createMany({
        data: sampleRows,
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
  fieldChecked?: string,
): Promise<AccuracyStats> {
  const where = {
    provider,
    cycleNumber,
    ...(clientId ? { clientId } : {}),
    ...(fieldChecked ? { fieldChecked } : {}),
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
  const computedRate = decided === 0 ? null : (100 * correct) / decided;
  const accuracyRate = reviewed < 10 ? null : computedRate;

  return {
    provider,
    cycleNumber,
    totalSampled,
    reviewed,
    correct,
    incorrect,
    pending,
    accuracyRate,
    alertLevel: alertFromStats(accuracyRate, reviewed),
  };
}

/**
 * One stats row per distinct cycle (newest first), up to `limit` cycles.
 */
export async function computeAccuracyTrend(
  provider: string,
  clientId: string,
  limit = 10,
  fieldChecked?: string,
): Promise<AccuracyStats[]> {
  const rows = await db.accuracySample.findMany({
    where: { provider, clientId, ...(fieldChecked ? { fieldChecked } : {}) },
    select: { cycleNumber: true },
  });
  const cycles = [...new Set(rows.map((r) => r.cycleNumber))]
    .sort((a, b) => b - a)
    .slice(0, limit);

  const out: AccuracyStats[] = [];
  for (const cycleNumber of cycles) {
    out.push(await computeAccuracyStats(provider, cycleNumber, clientId, fieldChecked));
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

/** Latest QA cycle accuracy for a provider (global, all clients). */
export async function getLatestProviderAccuracy(
  provider: string,
): Promise<{
  cycleNumber: number;
  accuracyRate: number | null;
  reviewed: number;
  alertLevel: AccuracyStats["alertLevel"];
} | null> {
  const agg = await db.accuracySample.aggregate({
    where: { provider },
    _max: { cycleNumber: true },
  });
  const cycleNumber = agg._max.cycleNumber;
  if (cycleNumber == null) return null;
  const stats = await computeAccuracyStats(provider, cycleNumber);
  return {
    cycleNumber,
    accuracyRate: stats.accuracyRate,
    reviewed: stats.reviewed,
    alertLevel: stats.alertLevel,
  };
}

export async function checkProviderQualityAlerts(): Promise<
  Array<{
    provider: string;
    cycleNumber: number;
    accuracyRate: number;
    alertLevel: "investigation" | "demotion";
  }>
> {
  const rows = await db.accuracySample.findMany({
    distinct: ["provider"],
    select: { provider: true },
    orderBy: { provider: "asc" },
  });

  const alerts: Array<{
    provider: string;
    cycleNumber: number;
    accuracyRate: number;
    alertLevel: "investigation" | "demotion";
  }> = [];

  for (const row of rows) {
    const agg = await db.accuracySample.aggregate({
      where: { provider: row.provider },
      _max: { cycleNumber: true },
    });
    const cycleNumber = agg._max.cycleNumber;
    if (cycleNumber == null) continue;

    const stats = await computeAccuracyStats(row.provider, cycleNumber);
    if (stats.accuracyRate == null) continue;
    if (stats.accuracyRate < 75) {
      alerts.push({
        provider: row.provider,
        cycleNumber,
        accuracyRate: stats.accuracyRate,
        alertLevel: "demotion",
      });
    } else if (stats.accuracyRate < 85) {
      alerts.push({
        provider: row.provider,
        cycleNumber,
        accuracyRate: stats.accuracyRate,
        alertLevel: "investigation",
      });
    }
  }

  return alerts.sort(
    (a, b) =>
      (a.alertLevel === "demotion" ? -1 : 1) -
      (b.alertLevel === "demotion" ? -1 : 1) ||
      a.provider.localeCompare(b.provider),
  );
}

/** Gate 2 population with a successful enrichment from `provider` (same as draw sample). */
export async function computeAccuracyPopulationSize(
  clientId: string,
  provider: string,
): Promise<number> {
  const logs = await db.enrichmentLog.findMany({
    where: {
      clientId,
      provider,
      status: "success",
      contactId: { not: null },
    },
    select: { contactId: true },
  });
  const contactIds = [...new Set(logs.map((r) => r.contactId).filter((id): id is string => Boolean(id)))];
  if (contactIds.length === 0) return 0;
  return db.contact.count({
    where: {
      id: { in: contactIds },
      clientId,
      gateStatus: "gate_2",
      mergedIntoId: null,
    },
  });
}

export function computePlannedSampleSize(populationSize: number): number {
  if (populationSize < 50) return populationSize;
  return Math.max(50, Math.min(200, Math.ceil(populationSize * 0.01)));
}
