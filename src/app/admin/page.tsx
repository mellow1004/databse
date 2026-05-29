import {
  AlertTriangle,
  Clock3,
  Database,
  Megaphone,
  ShieldCheck,
  ShieldX,
  Award,
  Radio,
  RefreshCcw,
  Phone,
  Users,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/lib/db";
import { getStatusVariant } from "@/lib/badge-helpers";
import RetentionActions from "./RetentionActions";

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
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000);
  const thirtyDaysFromNow = new Date(Date.now() + 30 * 86_400_000);

  const [
    gate1Count,
    gate2Count,
    gate3Count,
    campaignActiveCount,
    staleDueForRefreshCount,
    retentionDueCount,
    otto2ActiveCallingCount,
    auditLogs,
    latestClient,
    tombstoneCount,
    mergeCount,
    lastCompletedBatch,
    cognismAccuracy,
    apolloAccuracy,
    dsarApproachingDeadline,
    retentionRows,
    providerBudgetAlerts,
  ] = await Promise.all([
    db.contact.count({
      where: { gateStatus: "gate_1", mergedIntoId: null },
    }),
    db.contact.count({
      where: { gateStatus: "gate_2", mergedIntoId: null },
    }),
    db.contact.count({
      where: { gateStatus: "gate_3", mergedIntoId: null },
    }),
    db.contact.count({
      where: { campaignActive: true },
    }),
    db.contact.count({
      where: {
        gateStatus: "gate_2",
        lastVerifiedAt: { lt: ninetyDaysAgo },
      },
    }),
    db.contact.count({
      where: {
        OR: [
          { retentionStatus: "approaching_review" },
          { retentionReviewDueAt: { lt: thirtyDaysFromNow } },
        ],
      },
    }),
    db.otto2CallbackQueue.findMany({
      where: { status: "pending" },
      distinct: ["contactId"],
      select: { contactId: true },
    }),
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
    db.contact.findMany({
      where: {
        OR: [
          { retentionStatus: "approaching_review" },
          { retentionReviewDueAt: { lt: thirtyDaysFromNow } },
        ],
      },
      take: 12,
      orderBy: [{ retentionReviewDueAt: "asc" }, { updatedAt: "desc" }],
      include: {
        person: { select: { fullName: true } },
        company: { select: { id: true, legalName: true } },
      },
    }),
    db.providerBudget.findMany({
      where: {
        status: "active",
        alertedAt: { not: null },
        periodEnd: { gt: new Date() },
      },
      select: {
        id: true,
        provider: true,
        spentEur: true,
        budgetEur: true,
      },
      orderBy: { alertedAt: "desc" },
      take: 5,
    }),
  ]);

  const idsByType = new Map<string, Set<string>>();
  for (const log of auditLogs) {
    if (!log.resourceId) continue;
    const set = idsByType.get(log.resourceType) ?? new Set<string>();
    set.add(log.resourceId);
    idsByType.set(log.resourceType, set);
  }
  const contactIds = [...(idsByType.get("contact") ?? new Set())];
  const batchIds = [...(idsByType.get("import_batch") ?? new Set())];
  const companyIds = [...(idsByType.get("company") ?? new Set())];
  const suppressionIds = [...(idsByType.get("suppression") ?? new Set())];
  const quarantineIds = [...(idsByType.get("quarantine_log") ?? new Set())];
  const refreshIds = [...(idsByType.get("refresh_log") ?? new Set())];

  const [contacts, importBatches, companies, suppressions, quarantineLogs, refreshLogs] = await Promise.all([
    contactIds.length
      ? db.contact.findMany({
          where: { id: { in: contactIds } },
          select: { id: true, email: true, person: { select: { fullName: true } } },
        })
      : [],
    batchIds.length
      ? db.importBatch.findMany({ where: { id: { in: batchIds } }, select: { id: true, fileName: true } })
      : [],
    companyIds.length
      ? db.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, legalName: true } })
      : [],
    suppressionIds.length
      ? db.suppression.findMany({
          where: { id: { in: suppressionIds } },
          select: { id: true, scope: true, email: true, domain: true },
        })
      : [],
    quarantineIds.length
      ? db.quarantineLog.findMany({
          where: { id: { in: quarantineIds } },
          select: { id: true, contactId: true },
        })
      : [],
    refreshIds.length
      ? db.refreshLog.findMany({
          where: { id: { in: refreshIds } },
          select: { id: true, cycleNumber: true },
        })
      : [],
  ]);
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const batchById = new Map(importBatches.map((b) => [b.id, b]));
  const companyById = new Map(companies.map((c) => [c.id, c]));
  const suppressionById = new Map(suppressions.map((s) => [s.id, s]));
  const quarantineById = new Map(quarantineLogs.map((q) => [q.id, q]));
  const refreshById = new Map(refreshLogs.map((r) => [r.id, r]));

  function resourceNode(log: (typeof auditLogs)[0]): ReactNode {
    if (!log.resourceId) return <span className="text-muted-foreground">—</span>;
    if (log.resourceType === "contact") {
      const c = contactById.get(log.resourceId);
      const label = c ? `${c.person.fullName} (${c.email ?? "no email"})` : `…${log.resourceId.slice(-6)}`;
      return <Link href={`/admin/contacts/${log.resourceId}`} className="hover:underline">{label}</Link>;
    }
    if (log.resourceType === "import_batch") {
      const b = batchById.get(log.resourceId);
      const label = b?.fileName ?? `…${log.resourceId.slice(-6)}`;
      return <Link href={`/admin/intake/batches/${log.resourceId}`} className="hover:underline">{label}</Link>;
    }
    if (log.resourceType === "company") {
      const c = companyById.get(log.resourceId);
      const label = c?.legalName ?? `…${log.resourceId.slice(-6)}`;
      return <Link href={`/admin/companies/${log.resourceId}`} className="hover:underline">{label}</Link>;
    }
    if (log.resourceType === "suppression") {
      const s = suppressionById.get(log.resourceId);
      const target = s?.email ?? s?.domain ?? "target";
      const label = s ? `${s.scope} suppression (${target})` : `…${log.resourceId.slice(-6)}`;
      return <Link href="/admin/suppressions" className="hover:underline">{label}</Link>;
    }
    if (log.resourceType === "quarantine_log") {
      const q = quarantineById.get(log.resourceId);
      if (q?.contactId) {
        const c = contactById.get(q.contactId);
        const label = c ? c.person.fullName : `…${q.contactId.slice(-6)}`;
        return <Link href="/admin/quarantine" className="hover:underline">{label}</Link>;
      }
      return <span className="text-muted-foreground">…{log.resourceId.slice(-6)}</span>;
    }
    if (log.resourceType === "refresh_log") {
      const r = refreshById.get(log.resourceId);
      const label = r ? `Refresh cycle #${r.cycleNumber}` : `…${log.resourceId.slice(-6)}`;
      return <Link href="/admin/refresh-cycle" className="hover:underline">{label}</Link>;
    }
    return <span className="text-muted-foreground">…{log.resourceId.slice(-6)}</span>;
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-600">Overview of the Brightvision master database</p>
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

      {providerBudgetAlerts.length > 0 ? (
        <Alert>
          <AlertDescription>
            {providerBudgetAlerts.map((b) => {
              const pct = b.budgetEur > 0 ? Math.round((b.spentEur / b.budgetEur) * 100) : 0;
              return `Provider ${b.provider} at ${pct}% of monthly budget.`;
            }).join(" ")}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="border-dashed bg-slate-50 shadow-sm">
        <CardContent className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Radio className="mt-0.5 size-4 shrink-0 text-slate-500" aria-hidden />
            <div>
              <p className="text-sm font-medium text-slate-800">AI SDR Platform Simulator</p>
              <p className="text-xs text-slate-600">
                Demo tool for event-driven flows (targeting, assignment, bounces, replies).
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="shrink-0 sm:self-center" asChild>
            <Link href="/admin/platform-sim">Open simulator</Link>
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-1">
            <CardTitle className="text-xs font-medium text-slate-600">Gate 1</CardTitle>
            <ShieldX className="size-3.5 text-slate-400" aria-hidden />
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-2xl font-semibold tabular-nums">{gate1Count}</p>
            <p className="text-[11px] text-slate-500">Initial trust gate</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-1">
            <CardTitle className="text-xs font-medium text-slate-600">Gate 2</CardTitle>
            <Award className="size-3.5 text-slate-400" aria-hidden />
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-2xl font-semibold tabular-nums">{gate2Count}</p>
            <p className="text-[11px] text-slate-500">Trust floor reached</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-1">
            <CardTitle className="text-xs font-medium text-slate-600">Gate 3</CardTitle>
            <ShieldCheck className="size-3.5 text-slate-400" aria-hidden />
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-2xl font-semibold tabular-nums">{gate3Count}</p>
            <p className="text-[11px] text-slate-500">High-confidence tier</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-1">
            <CardTitle className="text-xs font-medium text-slate-600">Campaign-active</CardTitle>
            <Megaphone className="size-3.5 text-slate-400" aria-hidden />
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-2xl font-semibold tabular-nums">{campaignActiveCount}</p>
            <p className="text-[11px] text-slate-500">Currently in campaigns</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-1">
            <CardTitle className="text-xs font-medium text-slate-600">Stale due for refresh</CardTitle>
            <RefreshCcw className="size-3.5 text-slate-400" aria-hidden />
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-2xl font-semibold tabular-nums">{staleDueForRefreshCount}</p>
            <p className="text-[11px] text-slate-500">Gate 2 older than 90d</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-1">
            <CardTitle className="text-xs font-medium text-slate-600">Retention due</CardTitle>
            <Clock3 className="size-3.5 text-slate-400" aria-hidden />
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-2xl font-semibold tabular-nums">{retentionDueCount}</p>
            <p className="text-[11px] text-slate-500">Approaching retention review</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-1">
            <CardTitle className="text-xs font-medium text-slate-600">Active in Otto 2 calling</CardTitle>
            <Phone className="size-3.5 text-slate-400" aria-hidden />
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-2xl font-semibold tabular-nums">{otto2ActiveCallingCount.length}</p>
            <p className="text-[11px] text-slate-500">Pending callback queue (all clients)</p>
          </CardContent>
        </Card>
      </div>
      <p className="text-xs text-slate-500">
        Staging represents records below the trust floor. The PRD&apos;s three-gate model applies to Gate 1–3.
      </p>

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
                  <p className="text-xs text-slate-600">{resourceNode(log)}</p>
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
                Last refresh
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

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Approaching retention threshold</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Last verified</TableHead>
                <TableHead>Retention review due</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {retentionRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    No contacts approaching retention review.
                  </TableCell>
                </TableRow>
              ) : (
                retentionRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link href={`/admin/contacts/${r.id}`} className="hover:underline">
                        {r.person.fullName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/admin/companies/${r.company.id}`} className="hover:underline">
                        {r.company.legalName}
                      </Link>
                    </TableCell>
                    <TableCell>{r.lastVerifiedAt ? formatRelativeTime(r.lastVerifiedAt) : "—"}</TableCell>
                    <TableCell>{r.retentionReviewDueAt ? formatRelativeTime(r.retentionReviewDueAt) : "—"}</TableCell>
                    <TableCell>
                      <Badge className={getStatusVariant(r.retentionStatus)}>{r.retentionStatus}</Badge>
                    </TableCell>
                    <TableCell>
                      <RetentionActions contactId={r.id} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
