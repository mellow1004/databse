import { ChevronRight } from "lucide-react";
import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/lib/db";
import { getStatusVariant } from "@/lib/badge-helpers";
import PromoteSection, { type ExistingOutcome } from "./PromoteSection";
import ProcessSection, { type PipelineSummary } from "./ProcessSection";
import { StagingFilterTabs } from "./StagingFilterTabs";

export const dynamic = "force-dynamic";

const SOURCE_LABELS: Record<string, string> = {
  crm_export: "CRM export",
  campaign_file: "Campaign file",
  spreadsheet: "Spreadsheet",
  vendor_export: "Vendor export",
  manual: "Manual",
};

type FilterStatus = "all" | "accepted" | "rejected";

function formatDate(d: Date): string {
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

function prettyRaw(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export default async function BatchDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const batch = await db.importBatch.findUnique({ where: { id } });
  if (!batch) notFound();

  const [
    client,
    uploader,
    allRecords,
    latestPromotedAudit,
    latestPipelineAudit,
    promotedContactCount,
  ] = await Promise.all([
    db.client.findUnique({
      where: { id: batch.clientId },
      select: { id: true, name: true },
    }),
    db.user.findUnique({
      where: { id: batch.uploadedBy },
      select: { id: true, fullName: true },
    }),
    db.stagingRecord.findMany({
      where: { batchId: id },
      orderBy: { rowNumber: "asc" },
    }),
    db.auditLog.findFirst({
      where: { resourceId: id, action: "batch_promoted" },
      orderBy: { createdAt: "desc" },
      select: { afterState: true, createdAt: true },
    }),
    db.auditLog.findFirst({
      where: { resourceId: id, action: "pipeline_completed" },
      orderBy: { createdAt: "desc" },
      select: { afterState: true },
    }),
    db.stagingRecord.count({
      where: { batchId: id, status: "promoted", promotedContactId: { not: null } },
    }),
  ]);

  let existingOutcome: ExistingOutcome | null = null;
  if (latestPromotedAudit?.afterState) {
    try {
      const parsed = JSON.parse(latestPromotedAudit.afterState);
      if (
        typeof parsed?.newPersons === "number" &&
        typeof parsed?.newCompanies === "number" &&
        typeof parsed?.newContacts === "number" &&
        typeof parsed?.matchedExistingContacts === "number"
      ) {
        existingOutcome = {
          newPersons: parsed.newPersons,
          newCompanies: parsed.newCompanies,
          newContacts: parsed.newContacts,
          matchedExistingContacts: parsed.matchedExistingContacts,
        };
      }
    } catch {
      /* ignore */
    }
  }

  let existingPipelineResult: PipelineSummary | null = null;
  if (latestPipelineAudit?.afterState) {
    try {
      const parsed = JSON.parse(latestPipelineAudit.afterState);
      if (
        parsed?.verification &&
        parsed?.enrichment &&
        parsed?.gates &&
        typeof parsed?.contactCount === "number"
      ) {
        existingPipelineResult = parsed as PipelineSummary;
      }
    } catch {
      /* ignore */
    }
  }

  const rawStatus = (sp.status ?? "all").toLowerCase();
  const filter: FilterStatus =
    rawStatus === "accepted" || rawStatus === "rejected" ? rawStatus : "all";
  const records =
    filter === "all"
      ? allRecords
      : allRecords.filter((r) => r.status === filter);

  const counts = {
    all: allRecords.length,
    accepted: allRecords.filter((r) => r.status === "accepted").length,
    rejected: allRecords.filter((r) => r.status === "rejected").length,
  };

  const rejectionCounts: Record<string, number> = {};
  for (const r of allRecords) {
    if (r.status === "rejected" && r.rejectionReason) {
      rejectionCounts[r.rejectionReason] =
        (rejectionCounts[r.rejectionReason] ?? 0) + 1;
    }
  }
  const rejectionEntries = Object.entries(rejectionCounts).sort(
    (a, b) => b[1] - a[1],
  );
  const isRollbackEligible =
    !!latestPromotedAudit &&
    Date.now() - latestPromotedAudit.createdAt.getTime() <= 30 * 86_400_000;

  return (
    <div className="space-y-6">
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1">
            <CardTitle className="text-xl">{batch.fileName}</CardTitle>
            <p className="text-xs text-muted-foreground">
              {(batch.fileSizeBytes / 1024).toFixed(1)} KB
            </p>
            <p className="text-sm font-medium text-slate-900">
              batch_id: <code className="font-mono">{batch.id}</code>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-slate-500">Processing stage</span>
            <Badge className={getStatusVariant(batch.status)}>{batch.status}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Client
              </p>
              <p className="mt-0.5 text-slate-900">{client?.name ?? batch.clientId}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Source
              </p>
              <p className="mt-0.5 text-slate-900">
                {SOURCE_LABELS[batch.source] ?? batch.source}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Uploaded by
              </p>
              <p className="mt-0.5 text-slate-900">
                {uploader?.fullName ?? batch.uploadedBy}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Uploaded at
              </p>
              <p className="mt-0.5 font-mono tabular-nums text-slate-900">
                {formatDate(batch.startedAt)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="text-slate-600">
              <span className="font-medium text-slate-900">Total:</span>{" "}
              {batch.rowsTotal}
            </span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-600">
              <span className="font-medium text-slate-900">Accepted:</span>{" "}
              {batch.rowsAccepted}
            </span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-600">
              <span className="font-medium text-slate-900">Rejected:</span>{" "}
              {batch.rowsRejected}
            </span>
          </div>
          {batch.sourceDetail ? (
            <p className="text-xs text-muted-foreground">
              Source detail: {batch.sourceDetail}
            </p>
          ) : null}
          {isRollbackEligible ? (
            <Button variant="link" asChild className="h-auto px-0 text-sm">
              <Link href={`/admin/rollback?batchId=${encodeURIComponent(batch.id)}`}>
                View rollback eligibility →
              </Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <PromoteSection
          batchId={batch.id}
          status={batch.status}
          rowsAccepted={batch.rowsAccepted}
          rowsPromoted={batch.rowsPromoted}
          existingOutcome={existingOutcome}
        />
        <ProcessSection
          batchId={batch.id}
          batchStatus={batch.status}
          rowsPromoted={batch.rowsPromoted}
          contactCount={promotedContactCount}
          existingPipelineResult={existingPipelineResult}
        />
      </div>

      {batch.rowsRejected > 0 && rejectionEntries.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500">
            Rejection breakdown:
          </span>
          {rejectionEntries.map(([reason, count]) => (
            <Badge key={reason} className={getStatusVariant("rejected")}>
              {reason}: {count}
            </Badge>
          ))}
        </div>
      ) : null}

      <StagingFilterTabs batchId={batch.id} filter={filter} counts={counts} />

      <Card className="shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Title</TableHead>
                <TableHead className="w-16">Country</TableHead>
                <TableHead>Rejection reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    No rows match this filter.
                  </TableCell>
                </TableRow>
              ) : (
                records.map((r) => (
                  <Fragment key={r.id}>
                    <TableRow>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {r.rowNumber}
                      </TableCell>
                      <TableCell>
                        <Badge className={getStatusVariant(r.status)}>{r.status}</Badge>
                      </TableCell>
                      <TableCell>
                        {r.status === "promoted" && r.promotedContactId ? (
                          <Link
                            href={`/admin/contacts/${r.promotedContactId}`}
                            className="font-medium text-primary underline-offset-4 hover:underline"
                          >
                            {r.candidateEmail ?? "(no email)"}
                          </Link>
                        ) : (
                          (r.candidateEmail ?? "—")
                        )}
                      </TableCell>
                      <TableCell>{r.candidateFullName ?? "—"}</TableCell>
                      <TableCell>{r.candidateCompanyName ?? "—"}</TableCell>
                      <TableCell>{r.candidateTitle ?? "—"}</TableCell>
                      <TableCell>{r.candidateCountry ?? "—"}</TableCell>
                      <TableCell
                        className={
                          r.rejectionReason ? "text-rose-700" : "text-muted-foreground"
                        }
                      >
                        {r.rejectionReason ?? "—"}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={8} className="p-0">
                        <details className="group border-t bg-muted/30">
                          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
                            <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90" />
                            Raw values
                          </summary>
                          <pre className="max-h-64 overflow-auto p-4 text-xs">
                            {prettyRaw(r.rawValues)}
                          </pre>
                          {r.rejectionDetail ? (
                            <p className="px-4 pb-3 text-xs text-rose-700">
                              Detail: {r.rejectionDetail}
                            </p>
                          ) : null}
                        </details>
                      </TableCell>
                    </TableRow>
                  </Fragment>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Button variant="link" asChild className="h-auto px-0">
        <Link href="/admin/intake/batches">← Back to all batches</Link>
      </Button>
    </div>
  );
}
