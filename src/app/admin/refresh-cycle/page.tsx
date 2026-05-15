import { Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { db } from "@/lib/db";
import type { RefreshLogRow } from "@/lib/refresh-cycle-types";
import { RefreshCycleClient } from "./RefreshCycleClient";

export const dynamic = "force-dynamic";

function parseCostBreakdownFromNotes(
  notes: string | null,
): RefreshLogRow["costBreakdown"] {
  if (!notes) return [];
  try {
    const parsed = JSON.parse(notes) as {
      costBreakdown?: RefreshLogRow["costBreakdown"];
    };
    if (Array.isArray(parsed.costBreakdown)) {
      return parsed.costBreakdown;
    }
  } catch {
    /* ignore */
  }
  return [];
}

function durationSeconds(
  startedAt: Date,
  completedAt: Date | null,
): number {
  if (!completedAt) return 0;
  return Math.max(0, Math.round((completedAt.getTime() - startedAt.getTime()) / 1000));
}

export default async function RefreshCyclePage() {
  const clients = await db.client.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const rows = await db.refreshLog.findMany({
    orderBy: { startedAt: "desc" },
    take: 10,
    select: {
      id: true,
      clientId: true,
      cycleNumber: true,
      startedAt: true,
      completedAt: true,
      status: true,
      recordsReVerified: true,
      recordsDowngraded: true,
      recordsAnonymised: true,
      costEstimate: true,
      notes: true,
    },
  });

  const pastCycles: RefreshLogRow[] = rows.map((r) => ({
    id: r.id,
    clientId: r.clientId,
    cycleNumber: r.cycleNumber,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    status: r.status,
    recordsReVerified: r.recordsReVerified,
    recordsDowngraded: r.recordsDowngraded,
    recordsAnonymised: r.recordsAnonymised,
    costEstimate: r.costEstimate,
    durationSeconds: durationSeconds(r.startedAt, r.completedAt),
    costBreakdown: parseCostBreakdownFromNotes(r.notes),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Refresh cycle</h1>
        <p className="text-sm text-slate-600">
          Quarterly maintenance pass: re-verify, re-enrich, re-evaluate gates, anonymise
          expired records. Generates a cost-per-cycle report.
        </p>
      </div>

      <Alert>
        <Info className="size-4 shrink-0" aria-hidden />
        <AlertDescription>
          Each cycle processes the oldest gate_2 contacts first. Anonymisation strips PII
          from contacts inactive for 12+ months. Cost is estimated using provider list prices
          (demo data).
        </AlertDescription>
      </Alert>

      <RefreshCycleClient clients={clients} pastCycles={pastCycles} />
    </div>
  );
}
