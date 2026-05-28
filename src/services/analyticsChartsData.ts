import type {
  GateDistributionRow,
  ProviderTrendRow,
  SuppressionGrowthRow,
  VerificationDayRow,
} from "@/lib/analytics-chart-types";
import { db } from "@/lib/db";
import { computeAccuracyStats } from "@/services/accuracy";

const GATE_ORDER = ["gate_0", "gate_1", "gate_2", "gate_3"] as const;
export type AnalyticsFilterInput = {
  clientId?: string;
  provider?: string;
  market?: string;
  dateFrom?: Date;
};

function gateLabel(gate: string): string {
  if (gate === "gate_0") return "Staging / Below floor";
  return gate.replace(/_/g, " ");
}

export async function getGateDistribution(filters: AnalyticsFilterInput = {}): Promise<GateDistributionRow[]> {
  const grouped = await db.contact.groupBy({
    by: ["gateStatus"],
    where: {
      mergedIntoId: null,
      ...(filters.clientId ? { clientId: filters.clientId } : {}),
      ...(filters.market ? { market: filters.market } : {}),
      ...(filters.dateFrom ? { updatedAt: { gte: filters.dateFrom } } : {}),
    },
    _count: { _all: true },
  });
  const byStatus = new Map(grouped.map((g) => [g.gateStatus, g._count._all]));
  const total = grouped.reduce((s, g) => s + g._count._all, 0);
  return GATE_ORDER.map((gate) => {
    const count = byStatus.get(gate) ?? 0;
    return {
      gate,
      count,
      label: `${gateLabel(gate)} (${total > 0 ? Math.round((count / total) * 1000) / 10 : 0}%)`,
    };
  });
}

async function reviewedCycleNumbers(provider: string): Promise<number[]> {
  const rows = await db.accuracySample.groupBy({
    by: ["cycleNumber"],
    where: {
      provider,
      reviewedAt: { not: null },
      isCorrect: { not: null },
    },
    _count: { _all: true },
  });
  return rows.map((r) => r.cycleNumber).sort((a, b) => a - b);
}

/** Last `limit` distinct cycle numbers (globally, all clients) with reviewed samples, ascending. */
async function lastReviewedCycles(provider: string, limit: number): Promise<number[]> {
  const all = await reviewedCycleNumbers(provider);
  return all.slice(-limit);
}

export async function getProviderTrendInsufficient(filters: AnalyticsFilterInput = {}): Promise<{
  insufficient: boolean;
  rows: ProviderTrendRow[];
}> {
  const providers = filters.provider ? [filters.provider] : ["cognism", "apollo"];
  const [p1, p2] = providers.length === 1 ? [providers[0], providers[0]] : providers;
  const [cogCycles, apoCycles] = await Promise.all([
    reviewedCycleNumbers(p1),
    reviewedCycleNumbers(p2),
  ]);
  const insufficient = cogCycles.length < 2 || apoCycles.length < 2;

  const lastCog = await lastReviewedCycles(p1, 10);
  const lastApo = await lastReviewedCycles(p2, 10);
  const cycleSet = new Set<number>([...lastCog, ...lastApo]);
  const cycles = [...cycleSet].sort((a, b) => a - b);

  const rows: ProviderTrendRow[] = [];
  for (const cycle of cycles) {
    const [cogStats, apoStats] = await Promise.all([
      computeAccuracyStats(p1, cycle, filters.clientId),
      computeAccuracyStats(p2, cycle, filters.clientId),
    ]);
    if (filters.dateFrom) {
      const samplesSince = await db.accuracySample.count({
        where: { provider: { in: [p1, p2] }, sampledAt: { gte: filters.dateFrom } },
      });
      if (samplesSince === 0) continue;
    }
    rows.push({
      cycle,
      cognism: cogStats.accuracyRate,
      apollo: apoStats.accuracyRate,
    });
  }
  return { insufficient, rows };
}

function dateKeyLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function last30DayKeys(): string[] {
  const keys: string[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    keys.push(dateKeyLocal(d));
  }
  return keys;
}

export async function getVerificationVolumeByDay(filters: AnalyticsFilterInput = {}): Promise<VerificationDayRow[]> {
  const keys = last30DayKeys();
  const since = filters.dateFrom ?? new Date(keys[0]! + "T00:00:00");
  const marketContactIds =
    filters.market
      ? (
          await db.contact.findMany({
            where: { market: filters.market, ...(filters.clientId ? { clientId: filters.clientId } : {}) },
            select: { id: true },
          })
        ).map((c) => c.id)
      : [];
  const rows = await db.verification.findMany({
    where: {
      createdAt: { gte: since },
      ...(filters.clientId ? { clientId: filters.clientId } : {}),
      ...(filters.provider ? { provider: filters.provider } : {}),
      ...(filters.market ? { contactId: { in: marketContactIds } } : {}),
    },
    select: { createdAt: true, status: true },
  });

  const buckets = new Map<string, { valid: number; invalid: number; risky: number; unknown: number }>();
  for (const k of keys) {
    buckets.set(k, { valid: 0, invalid: 0, risky: 0, unknown: 0 });
  }

  for (const r of rows) {
    const k = dateKeyLocal(new Date(r.createdAt));
    if (!buckets.has(k)) continue;
    const b = buckets.get(k)!;
    const st = (r.status ?? "").toLowerCase();
    if (st === "valid") b.valid += 1;
    else if (st === "invalid") b.invalid += 1;
    else if (st === "risky") b.risky += 1;
    else b.unknown += 1;
  }

  return keys.map((day) => {
    const b = buckets.get(day)!;
    const [, m, d] = day.split("-");
    return {
      day,
      dayLabel: `${m}/${d}`,
      valid: b.valid,
      invalid: b.invalid,
      risky: b.risky,
      unknown: b.unknown,
    };
  });
}

/** Cumulative suppression records created on or before end of each day (monotone). */
export async function getSuppressionCumulativeByDay(filters: AnalyticsFilterInput = {}): Promise<SuppressionGrowthRow[]> {
  const keys = last30DayKeys();
  const times = (
    await db.suppression.findMany({
      where: {
        ...(filters.clientId ? { OR: [{ clientId: filters.clientId }, { clientId: null }] } : {}),
        ...(filters.dateFrom ? { createdAt: { gte: filters.dateFrom } } : {}),
      },
      select: { createdAt: true },
    })
  )
    .map((s) => s.createdAt.getTime())
    .sort((a, b) => a - b);

  function countLeq(tMs: number): number {
    let lo = 0;
    let hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid]! <= tMs) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  return keys.map((day) => {
    const end = new Date(`${day}T23:59:59.999`).getTime();
    const total = countLeq(end);
    const [, m, d] = day.split("-");
    return { day, dayLabel: `${m}/${d}`, total };
  });
}
