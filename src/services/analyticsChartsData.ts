import type {
  GateDistributionRow,
  ProviderTrendRow,
  SuppressionGrowthRow,
  VerificationDayRow,
} from "@/lib/analytics-chart-types";
import { db } from "@/lib/db";
import { computeAccuracyStats } from "@/services/accuracy";

const GATE_ORDER = ["gate_0", "gate_1", "gate_2", "gate_3"] as const;

export async function getGateDistribution(): Promise<GateDistributionRow[]> {
  const grouped = await db.contact.groupBy({
    by: ["gateStatus"],
    where: { mergedIntoId: null },
    _count: { _all: true },
  });
  const byStatus = new Map(grouped.map((g) => [g.gateStatus, g._count._all]));
  const total = grouped.reduce((s, g) => s + g._count._all, 0);
  return GATE_ORDER.map((gate) => {
    const count = byStatus.get(gate) ?? 0;
    return {
      gate,
      count,
      label: `${gate.replace(/_/g, " ")} (${total > 0 ? Math.round((count / total) * 1000) / 10 : 0}%)`,
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

export async function getProviderTrendInsufficient(): Promise<{
  insufficient: boolean;
  rows: ProviderTrendRow[];
}> {
  const [cogCycles, apoCycles] = await Promise.all([
    reviewedCycleNumbers("cognism"),
    reviewedCycleNumbers("apollo"),
  ]);
  const insufficient = cogCycles.length < 2 || apoCycles.length < 2;

  const lastCog = await lastReviewedCycles("cognism", 10);
  const lastApo = await lastReviewedCycles("apollo", 10);
  const cycleSet = new Set<number>([...lastCog, ...lastApo]);
  const cycles = [...cycleSet].sort((a, b) => a - b);

  const rows: ProviderTrendRow[] = [];
  for (const cycle of cycles) {
    const [cogStats, apoStats] = await Promise.all([
      computeAccuracyStats("cognism", cycle, undefined),
      computeAccuracyStats("apollo", cycle, undefined),
    ]);
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

export async function getVerificationVolumeByDay(): Promise<VerificationDayRow[]> {
  const keys = last30DayKeys();
  const since = new Date(keys[0]! + "T00:00:00");
  const rows = await db.verification.findMany({
    where: { createdAt: { gte: since } },
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
export async function getSuppressionCumulativeByDay(): Promise<SuppressionGrowthRow[]> {
  const keys = last30DayKeys();
  const times = (
    await db.suppression.findMany({
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
