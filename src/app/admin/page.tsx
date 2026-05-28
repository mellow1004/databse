import {
  AlertTriangle,
  Award,
  Lock,
  Radio,
  Users,
} from "lucide-react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const AUDIT_VERB_LABELS: Record<string, string> = {
  batch_promoted: "Batch promoted",
  conflict_resolved: "Conflict resolved",
  suppression_added: "Suppression added",
  quarantine_released: "Quarantine released",
  quarantine_marked_reviewed: "Quarantine reviewed",
  merge_executed: "Merge executed",
  gate_promoted: "Gate promoted",
  enrichment_triggered: "Enrichment triggered",
  enrichment_batch_completed: "Enrichment batch completed",
  verification_batch_completed: "Verification batch completed",
  intake_completed: "Intake completed",
  pipeline_completed: "Pipeline completed",
  refresh_cycle_started: "Refresh cycle started",
  refresh_cycle_completed: "Refresh cycle completed",
  dsar_received: "DSAR received",
  dsar_completed: "DSAR completed",
  bulk_export: "Bulk export",
  rollback_executed: "Rollback executed",
  rbac_change: "RBAC change",
  schema_migration_applied: "Schema migration applied",
  integration_contract_renewed: "Contract renewed",
};

function auditVerbLabel(action: string): string {
  return (
    AUDIT_VERB_LABELS[action] ??
    action
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

function formatRelativeTime(date: Date): string {
  const diffSec = Math.round((date.getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(diffSec, "second");
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");
  const diffHour = Math.round(diffSec / 3600);
  if (Math.abs(diffHour) < 24) return rtf.format(diffHour, "hour");
  const diffDay = Math.round(diffSec / 86400);
  if (Math.abs(diffDay) < 7) return rtf.format(diffDay, "day");
  const diffWeek = Math.round(diffSec / 604800);
  if (Math.abs(diffWeek) < 5) return rtf.format(diffWeek, "week");
  const diffMonth = Math.round(diffSec / 2592000);
  if (Math.abs(diffMonth) < 12) return rtf.format(diffMonth, "month");
  const diffYear = Math.round(diffSec / 31536000);
  return rtf.format(diffYear, "year");
}

function formatDateTime(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

async function latestAccuracyRate(provider: string): Promise<string | null> {
  const maxCycle = await db.accuracySample.aggregate({
    where: { provider, reviewedAt: { not: null }, isCorrect: { not: null } },
    _max: { cycleNumber: true },
  });
  const cycle = maxCycle._max.cycleNumber;
  if (cycle == null) return null;

  const [correct, total] = await Promise.all([
    db.accuracySample.count({
      where: {
        provider,
        cycleNumber: cycle,
        reviewedAt: { not: null },
        isCorrect: true,
      },
    }),
    db.accuracySample.count({
      where: {
        provider,
        cycleNumber: cycle,
        reviewedAt: { not: null },
        isCorrect: { not: null },
      },
    }),
  ]);
  if (total === 0) return null;
  const pct = Math.round((correct / total) * 1000) / 10;
  return `${pct}% (${correct}/${total} reviewed)`;
}

export default async function AdminDashboardPage() {
  const [
    totalContacts,
    gate2Ready,
    pendingQuarantine,
    pendingConflicts,
    auditLogs,
    latestClient,
    tombstoneCount,
    mergeCount,
    lastCompletedBatch,
    cognismAccuracy,
    apolloAccuracy,
    dsarApproachingDeadline,
  ] = await Promise.all([
    db.contact.count({ where: { mergedIntoId: null } }),
    db.contact.count({
      where: { gateStatus: "gate_2", mergedIntoId: null },
    }),
    db.quarantineLog.count({ where: { reviewState: "pending" } }),
    db.enrichmentLog.count({ where: { status: "conflict_pending" } }),
    db.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        action: true,
        resourceType: true,
        resourceId: true,
        batchId: true,
        afterState: true,
        createdAt: true,
      },
    }),
    db.client.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    db.tombstone.count(),
    db.mergeHistory.count(),
    db.importBatch.findFirst({
      where: { status: "completed" },
      orderBy: { completedAt: "desc" },
      select: { completedAt: true, fileName: true },
    }),
    latestAccuracyRate("cognism"),
    latestAccuracyRate("apollo"),
    db.dsarCase.count({
      where: {
        status: { not: "completed" },
        deadlineAt: { lt: new Date(Date.now() + 7 * 86_400_000) },
      },
    }),
  ]);

  const batchIds = [
    ...new Set(
      auditLogs
        .map((l) => l.batchId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const importBatches =
    batchIds.length > 0
      ? await db.importBatch.findMany({
          where: { id: { in: batchIds } },
          select: { id: true, fileName: true },
        })
      : [];
  const batchFileById = new Map(importBatches.map((b) => [b.id, b.fileName]));

  const contactIds = [
    ...new Set(
      auditLogs
        .filter((l) => l.resourceType === "contact" && l.resourceId)
        .map((l) => l.resourceId as string),
    ),
  ];
  const contacts =
    contactIds.length > 0
      ? await db.contact.findMany({
          where: { id: { in: contactIds } },
          select: {
            id: true,
            person: { select: { fullName: true } },
          },
        })
      : [];
  const contactNameById = new Map(
    contacts.map((c) => [c.id, c.person.fullName]),
  );

  function resourceLine(log: (typeof auditLogs)[0]): string {
    const fromBatch = log.batchId ? batchFileById.get(log.batchId) : undefined;
    if (fromBatch) return fromBatch;
    if (log.resourceType === "contact" && log.resourceId) {
      const name = contactNameById.get(log.resourceId);
      if (name) return name;
      return `Contact ${log.resourceId.slice(0, 8)}…`;
    }
    if (log.afterState) {
      try {
        const parsed = JSON.parse(log.afterState) as { fileName?: string };
        if (parsed.fileName) return parsed.fileName;
      } catch {
        /* ignore */
      }
    }
    if (log.batchId) return `Batch ${log.batchId}`;
    if (log.resourceType && log.resourceId) {
      return `${log.resourceType} ${log.resourceId.slice(0, 8)}…`;
    }
    if (log.resourceType) return log.resourceType;
    return "—";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Welcome back, Olivia</h1>
        <p className="mt-1 text-sm text-slate-600">
          Overview of the Brightvision master database
        </p>
      </div>
      <Separator />

      {dsarApproachingDeadline > 0 ? (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertDescription>
            {dsarApproachingDeadline} DSAR case(s) approaching the 30-day deadline.{" "}
            <Link href="/admin/dsar?filter=overdue" className="font-medium underline underline-offset-4">
              Review now →
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="border-primary/20 bg-primary/5 shadow-sm">
        <CardContent className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Radio className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <div>
              <p className="text-sm font-medium text-slate-900">
                New: AI SDR Platform Simulator
              </p>
              <p className="text-sm text-slate-600">
                Demonstrate event-driven flows (targeting, campaign assignment, bounces,
                replies) against the master database in real time.
              </p>
            </div>
          </div>
          <Button variant="default" size="sm" className="shrink-0 sm:self-center" asChild>
            <Link href="/admin/platform-sim">Open simulator</Link>
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">
              Total contacts
            </CardTitle>
            <Users className="size-4 text-slate-400" aria-hidden />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">{totalContacts}</p>
            <p className="text-xs text-slate-500">Active in master DB</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">
              Gate 2 ready
            </CardTitle>
            <Award className="size-4 text-slate-400" aria-hidden />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">{gate2Ready}</p>
            <p className="text-xs text-slate-500">Campaign-ready trust floor</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">
              Pending quarantine
            </CardTitle>
            <Lock className="size-4 text-slate-400" aria-hidden />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">
              {pendingQuarantine}
            </p>
            <p className="text-xs text-slate-500">Awaiting Data Owner review</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">
              Pending conflicts
            </CardTitle>
            <AlertTriangle className="size-4 text-slate-400" aria-hidden />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">
              {pendingConflicts}
            </p>
            <p className="text-xs text-slate-500">
              Enrichment conflicts flagged
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="shadow-sm lg:col-span-3">
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            <ul className="divide-y divide-slate-100">
              {auditLogs.map((log) => (
                <li key={log.id} className="px-6 py-3 first:pt-0">
                  <p className="text-sm font-medium text-slate-900">
                    {auditVerbLabel(log.action)}
                  </p>
                  <p className="text-xs text-slate-600">{resourceLine(log)}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {formatRelativeTime(log.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="shadow-sm lg:col-span-2">
          <CardHeader>
            <CardTitle>System status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex flex-col gap-0.5 border-b border-slate-100 pb-3">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Latest seed run
              </span>
              <span className="text-slate-900">
                {formatDateTime(latestClient?.createdAt ?? null)}
              </span>
            </div>
            <div className="flex flex-col gap-0.5 border-b border-slate-100 pb-3">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Total tombstones
              </span>
              <span className="font-semibold tabular-nums text-slate-900">
                {tombstoneCount}
              </span>
            </div>
            <div className="flex flex-col gap-0.5 border-b border-slate-100 pb-3">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Total merges executed
              </span>
              <span className="font-semibold tabular-nums text-slate-900">
                {mergeCount}
              </span>
            </div>
            <div className="flex flex-col gap-0.5 border-b border-slate-100 pb-3">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Last batch promoted
              </span>
              <span className="text-slate-900">
                {lastCompletedBatch?.completedAt
                  ? formatDateTime(lastCompletedBatch.completedAt)
                  : "—"}
              </span>
              {lastCompletedBatch?.fileName ? (
                <span className="text-xs text-slate-500">
                  {lastCompletedBatch.fileName}
                </span>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Provider accuracy snapshot
              </span>
              <div className="flex justify-between gap-2 text-slate-800">
                <span className="text-slate-600">Cognism</span>
                <span className="text-right font-medium">
                  {cognismAccuracy ?? "Not measured"}
                </span>
              </div>
              <div className="flex justify-between gap-2 text-slate-800">
                <span className="text-slate-600">Apollo</span>
                <span className="text-right font-medium">
                  {apolloAccuracy ?? "Not measured"}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <p className="text-center text-xs text-slate-500">
        Live demo?{" "}
        <Link href="/admin/demo-controls" className="text-primary underline-offset-2 hover:underline">
          Visit Demo controls
        </Link>{" "}
        to reset state or read the walkthrough script.
      </p>
    </div>
  );
}
