import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import PromoteSection, { type ExistingOutcome } from "./PromoteSection";
import ProcessSection, { type PipelineSummary } from "./ProcessSection";

// Detail counts must reflect the very latest write, so bypass caching.
export const dynamic = "force-dynamic";

const SOURCE_LABELS: Record<string, string> = {
  crm_export: "CRM export",
  campaign_file: "Campaign file",
  spreadsheet: "Spreadsheet",
  vendor_export: "Vendor export",
  manual: "Manual",
};

const BATCH_STATUS_BADGE: Record<string, string> = {
  uploaded: "bg-gray-100 text-gray-700",
  parsing: "bg-gray-100 text-gray-700",
  ready_for_review: "bg-blue-100 text-blue-800",
  promoting: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
};

const ROW_STATUS_BADGE: Record<string, string> = {
  pending: "bg-gray-100 text-gray-700",
  accepted: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  promoted: "bg-blue-100 text-blue-800",
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
    // Defensive: if a row was ever inserted with malformed JSON, surface the raw string
    // rather than crashing the entire page render.
    return raw;
  }
}

export default async function BatchDetailPage({
  params,
  searchParams,
}: {
  // Next.js 15+ App Router: dynamic route + searchParams arrive as Promises.
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
      select: { afterState: true },
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

  // Parse the most-recent batch_promoted audit entry into the 4 counts the
  // PromoteSection renders on a completed batch. Null otherwise.
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
      // Malformed JSON in the audit row — render fall-back card without counts.
    }
  }

  // Parse the most-recent pipeline_completed audit entry into the
  // PipelineSummary the ProcessSection renders.
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
      // Malformed JSON — leave null; ProcessSection will offer to run anew.
    }
  }

  // Filter for the rows table only; counts + breakdown always use the full set.
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

  // Per-reason rollup, used to render the rejection pill row.
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

  return (
    <main className="min-h-screen max-w-6xl mx-auto p-8">
      {/* ---- Header card ---- */}
      <div className="border rounded p-6">
        <h1 className="text-2xl font-semibold">{batch.fileName}</h1>
        <p className="text-xs text-gray-500 mt-1">
          {(batch.fileSizeBytes / 1024).toFixed(1)} KB · Batch{" "}
          <code className="font-mono">{batch.id}</code>
        </p>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <dl className="space-y-1">
            <div className="flex">
              <dt className="w-28 text-gray-500">Client</dt>
              <dd>{client?.name ?? batch.clientId}</dd>
            </div>
            <div className="flex">
              <dt className="w-28 text-gray-500">Source</dt>
              <dd>{SOURCE_LABELS[batch.source] ?? batch.source}</dd>
            </div>
            <div className="flex">
              <dt className="w-28 text-gray-500">Uploaded by</dt>
              <dd>{uploader?.fullName ?? batch.uploadedBy}</dd>
            </div>
            <div className="flex">
              <dt className="w-28 text-gray-500">Uploaded at</dt>
              <dd className="tabular-nums">{formatDate(batch.startedAt)}</dd>
            </div>
          </dl>

          <dl className="space-y-1">
            <div className="flex">
              <dt className="w-28 text-gray-500">Total rows</dt>
              <dd className="tabular-nums">{batch.rowsTotal}</dd>
            </div>
            <div className="flex">
              <dt className="w-28 text-gray-500">Accepted</dt>
              <dd className="tabular-nums text-green-700">{batch.rowsAccepted}</dd>
            </div>
            <div className="flex">
              <dt className="w-28 text-gray-500">Rejected</dt>
              <dd className="tabular-nums text-red-700">{batch.rowsRejected}</dd>
            </div>
            <div className="flex">
              <dt className="w-28 text-gray-500">Status</dt>
              <dd>
                <span
                  className={`text-xs px-2 py-1 rounded ${
                    BATCH_STATUS_BADGE[batch.status] ??
                    "bg-gray-100 text-gray-700"
                  }`}
                >
                  {batch.status}
                </span>
              </dd>
            </div>
          </dl>
        </div>

        {batch.sourceDetail && (
          <p className="mt-3 text-xs text-gray-500">
            Source detail: {batch.sourceDetail}
          </p>
        )}
      </div>

      {/* ---- Promotion section (state-dependent card) ---- */}
      <div className="mt-6">
        <PromoteSection
          batchId={batch.id}
          status={batch.status}
          rowsAccepted={batch.rowsAccepted}
          rowsPromoted={batch.rowsPromoted}
          existingOutcome={existingOutcome}
        />

        {/* ---- Phase-4 pipeline section ---- */}
        <ProcessSection
          batchId={batch.id}
          batchStatus={batch.status}
          rowsPromoted={batch.rowsPromoted}
          contactCount={promotedContactCount}
          existingPipelineResult={existingPipelineResult}
        />
      </div>

      {/* ---- Rejection breakdown pills ---- */}
      {batch.rowsRejected > 0 && rejectionEntries.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500">Rejection breakdown:</span>
          {rejectionEntries.map(([reason, count]) => (
            <span
              key={reason}
              className="bg-red-50 text-red-800 text-xs px-2 py-1 rounded"
            >
              {reason}: {count}
            </span>
          ))}
        </div>
      )}

      {/* ---- Filter tabs ---- */}
      <nav className="mt-6 flex items-center gap-4 text-sm border-b">
        {(
          [
            ["all", "All", counts.all],
            ["accepted", "Accepted", counts.accepted],
            ["rejected", "Rejected", counts.rejected],
          ] as const
        ).map(([value, label, count]) => {
          const isActive = filter === value;
          const href =
            value === "all"
              ? `/admin/intake/batches/${batch.id}`
              : `/admin/intake/batches/${batch.id}?status=${value}`;
          return (
            <Link
              key={value}
              href={href}
              className={`pb-2 -mb-px border-b-2 ${
                isActive
                  ? "border-blue-600 text-gray-900 font-medium"
                  : "border-transparent text-gray-600 hover:text-gray-900"
              }`}
            >
              {label} <span className="tabular-nums text-gray-500">({count})</span>
            </Link>
          );
        })}
      </nav>

      {/* ---- Rows table ---- */}
      <div className="mt-4 border rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium w-12">#</th>
              <th className="px-3 py-2 font-medium w-24">Status</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Company</th>
              <th className="px-3 py-2 font-medium">Title</th>
              <th className="px-3 py-2 font-medium w-16">Country</th>
              <th className="px-3 py-2 font-medium">Rejection reason</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-6 text-center text-sm text-gray-500"
                >
                  No rows match this filter.
                </td>
              </tr>
            ) : (
              records.map((r) => (
                <Fragment key={r.id}>
                  <tr className="border-b">
                    <td className="px-3 py-2 tabular-nums text-gray-500">
                      {r.rowNumber}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`text-xs px-2 py-1 rounded ${
                          ROW_STATUS_BADGE[r.status] ??
                          "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-800">
                      {r.status === "promoted" && r.promotedContactId ? (
                        <Link
                          href={`/admin/contacts/${r.promotedContactId}`}
                          className="text-blue-600 underline"
                        >
                          {r.candidateEmail ?? "(no email)"}
                        </Link>
                      ) : (
                        (r.candidateEmail ?? "—")
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-800">
                      {r.candidateFullName ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-gray-800">
                      {r.candidateCompanyName ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-gray-800">
                      {r.candidateTitle ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-gray-800">
                      {r.candidateCountry ?? "—"}
                    </td>
                    <td
                      className={`px-3 py-2 ${
                        r.rejectionReason ? "text-red-700" : "text-gray-400"
                      }`}
                    >
                      {r.rejectionReason ?? "—"}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={8} className="p-0">
                      <details className="border-t bg-gray-50">
                        <summary className="cursor-pointer px-4 py-2 text-xs text-gray-600">
                          Raw CSV values + rejection detail
                        </summary>
                        <pre className="p-4 text-xs overflow-auto">
                          {prettyRaw(r.rawValues)}
                        </pre>
                        {r.rejectionDetail && (
                          <p className="px-4 pb-3 text-xs text-red-700">
                            Detail: {r.rejectionDetail}
                          </p>
                        )}
                      </details>
                    </td>
                  </tr>
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-6">
        <Link
          href="/admin/intake/batches"
          className="text-blue-600 underline text-sm"
        >
          ← Back to all batches
        </Link>
      </p>
    </main>
  );
}
