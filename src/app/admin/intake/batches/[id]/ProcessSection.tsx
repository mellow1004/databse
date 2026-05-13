"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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
  const [localResult, setLocalResult] = useState<PipelineSummary | null>(
    existingPipelineResult,
  );

  useEffect(() => {
    setLocalResult(existingPipelineResult);
  }, [existingPipelineResult]);

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
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Run verification &amp; enrichment pipeline</CardTitle>
          <CardDescription>
            Runs MillionVerifier (with Bouncer fallback) → Cognism + Apollo enrichment →
            gate evaluation on {contactCount} promoted contacts. Conflicts where confidence
            delta &lt; 15% are flagged for manual review.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button type="button" onClick={onRun} disabled={loading} className="gap-2">
            {loading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : null}
            {loading ? "Running pipeline…" : "Run pipeline"}
          </Button>
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  const { verification, enrichment, gates } = localResult;
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle>Pipeline completed</CardTitle>
        <CardDescription>Bulk verification, enrichment, and gate evaluation results.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card className="border bg-card shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Verification
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="text-lg font-semibold tabular-nums">
                {verification.succeeded}/{verification.total} succeeded
              </p>
              <p className="text-xs text-muted-foreground">
                {formatCredits(verification.creditsByProvider)}
              </p>
              {verification.failed > 0 ? (
                <p className="text-xs text-rose-700">{verification.failed} failed</p>
              ) : null}
            </CardContent>
          </Card>
          <Card className="border bg-card shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Enrichment
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="text-lg font-semibold tabular-nums">
                {enrichment.enriched}/{enrichment.total} enriched
              </p>
              <p className="text-xs text-muted-foreground">
                {enrichment.conflictsFlagged} conflict
                {enrichment.conflictsFlagged === 1 ? "" : "s"} flagged · {enrichment.noMatch}{" "}
                no-match
              </p>
              {enrichment.skipped > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {enrichment.skipped} skipped (manual override)
                </p>
              ) : null}
            </CardContent>
          </Card>
          <Card className="border bg-card shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Gates
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="text-lg font-semibold tabular-nums">
                {gates.promoted} promoted to gate_2
              </p>
              <p className="text-xs text-muted-foreground">
                {gates.downgraded} downgraded · {gates.quarantined} quarantined ·{" "}
                {gates.unchanged} unchanged
              </p>
            </CardContent>
          </Card>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRun}
          disabled={loading}
          className="gap-2"
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : null}
          {loading ? "Re-running pipeline…" : "Re-run pipeline"}
        </Button>
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
