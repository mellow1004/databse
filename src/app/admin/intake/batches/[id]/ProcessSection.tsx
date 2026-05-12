"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Snapshot of the three bulk-service outputs the pipeline runs.
 * Both the API route handler and this card serialise/deserialise this shape
 * via the audit_log row stored on the import batch.
 */
export type PipelineSummary = {
  contactCount: number;
  verification: {
    total: number;
    succeeded: number;
    failed: number;
    creditsByProvider: Record<string, number>;
  };
  enrichment: {
    total: number;
    enriched: number;
    noMatch: number;
    skipped: number;
    failed: number;
    conflictsFlagged: number;
    creditsByProvider: Record<string, number>;
  };
  gates: {
    total: number;
    promoted: number;
    downgraded: number;
    unchanged: number;
    quarantined: number;
  };
};

type Props = {
  batchId: string;
  batchStatus: string;
  rowsPromoted: number;
  contactCount: number;
  existingPipelineResult: PipelineSummary | null;
};

function formatCredits(creditsByProvider: Record<string, number>): string {
  const entries = Object.entries(creditsByProvider).filter(([, n]) => n > 0);
  if (entries.length === 0) return "0 credits";
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  return `${total} credits across ${entries.length} provider${entries.length === 1 ? "" : "s"}`;
}

/**
 * The full Phase-4 trigger UI for one batch. Renders nothing for batches that
 * haven't been promoted yet, a blue "run pipeline" card when there's work to
 * do, and a green completed card with three result columns once an
 * audit_log#pipeline_completed row exists for this batch.
 */
export default function ProcessSection({
  batchId,
  batchStatus,
  rowsPromoted,
  contactCount,
  existingPipelineResult,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Optimistic mirror of existingPipelineResult so the green card appears
  // immediately after a successful run, before router.refresh() lands.
  const [localResult, setLocalResult] = useState<PipelineSummary | null>(
    existingPipelineResult,
  );

  if (batchStatus !== "completed" || rowsPromoted === 0) return null;

  async function onRun() {
    const ok = window.confirm(
      `Run verification + enrichment + gate evaluation on ${contactCount} contacts? This will consume mock provider credits and may flag conflicts for review.`,
    );
    if (!ok) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/intake/batches/${batchId}/process`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || data.error || `HTTP ${res.status}`);
        return;
      }
      // The route returns the same PipelineSummary shape we render here.
      setLocalResult(data as PipelineSummary);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  if (localResult === null) {
    return (
      <div className="mb-4 p-4 rounded border border-blue-300 bg-blue-50">
        <h2 className="font-medium text-blue-900">
          Run verification &amp; enrichment pipeline
        </h2>
        <p className="mt-1 text-sm text-blue-800">
          Runs MillionVerifier (with Bouncer fallback) → Cognism + Apollo
          enrichment → gate evaluation on {contactCount} promoted contacts.
          Conflicts where confidence delta &lt; 15% are flagged for manual
          review.
        </p>
        <button
          type="button"
          onClick={onRun}
          disabled={loading}
          className="mt-3 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded disabled:opacity-50"
        >
          {loading ? "Running pipeline…" : "Run pipeline"}
        </button>
        {error && <p className="mt-2 text-sm text-red-700">Error: {error}</p>}
      </div>
    );
  }

  const { verification, enrichment, gates } = localResult;
  return (
    <div className="mb-4 p-4 rounded border border-green-300 bg-green-50">
      <h2 className="font-medium text-green-900">Pipeline completed</h2>
      <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
        <div className="rounded border border-green-200 bg-white p-3">
          <div className="text-xs uppercase tracking-wide text-gray-500">
            Verification
          </div>
          <div className="mt-1 text-lg font-medium text-green-900 tabular-nums">
            {verification.succeeded}/{verification.total} succeeded
          </div>
          <div className="text-xs text-gray-700">
            {formatCredits(verification.creditsByProvider)}
          </div>
          {verification.failed > 0 && (
            <div className="text-xs text-red-700">{verification.failed} failed</div>
          )}
        </div>

        <div className="rounded border border-green-200 bg-white p-3">
          <div className="text-xs uppercase tracking-wide text-gray-500">
            Enrichment
          </div>
          <div className="mt-1 text-lg font-medium text-green-900 tabular-nums">
            {enrichment.enriched}/{enrichment.total} enriched
          </div>
          <div className="text-xs text-gray-700">
            {enrichment.conflictsFlagged} conflict
            {enrichment.conflictsFlagged === 1 ? "" : "s"} flagged ·{" "}
            {enrichment.noMatch} no-match
          </div>
          {enrichment.skipped > 0 && (
            <div className="text-xs text-gray-700">
              {enrichment.skipped} skipped (manual override)
            </div>
          )}
        </div>

        <div className="rounded border border-green-200 bg-white p-3">
          <div className="text-xs uppercase tracking-wide text-gray-500">Gates</div>
          <div className="mt-1 text-lg font-medium text-green-900 tabular-nums">
            {gates.promoted} promoted to gate_2
          </div>
          <div className="text-xs text-gray-700">
            {gates.downgraded} downgraded · {gates.quarantined} quarantined ·{" "}
            {gates.unchanged} unchanged
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onRun}
        disabled={loading}
        className="mt-3 text-xs text-blue-700 hover:underline disabled:opacity-50"
      >
        {loading ? "Re-running pipeline…" : "Re-run pipeline"}
      </button>
      {error && <p className="mt-2 text-sm text-red-700">Error: {error}</p>}
    </div>
  );
}
