"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  quarantineLogId: string;
  reviewState: string;
  /** When set, release is blocked in the UI (soft-merged contact). */
  mergedIntoId: string | null;
};

export default function QuarantineRowActions({
  quarantineLogId,
  reviewState,
  mergedIntoId,
}: Props) {
  const router = useRouter();
  const [releaseLoading, setReleaseLoading] = useState(false);
  const [markLoading, setMarkLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const releaseDisabled = mergedIntoId !== null;
  const canMarkReviewed = reviewState === "pending";
  const canRelease = reviewState === "pending" || reviewState === "reviewed";

  async function onRelease() {
    if (releaseDisabled) return;
    const reason = window.prompt("Reason for releasing this contact back to gate_1:");
    if (reason === null) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("A non-empty reason is required.");
      return;
    }
    setReleaseLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/quarantine/${quarantineLogId}/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || data.error || `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReleaseLoading(false);
    }
  }

  async function onMarkReviewed() {
    setMarkLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/quarantine/${quarantineLogId}/mark-reviewed`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || data.error || `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMarkLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex flex-wrap items-center gap-2">
        {canRelease ? (
          <span className="inline-flex items-center gap-1">
            {releaseDisabled ? (
              <span
                className="inline-flex shrink-0 cursor-help text-muted-foreground"
                title="Contact was merged into another record — release disabled"
                aria-label="Contact was merged into another record — release disabled"
              >
                <Lock className="size-3.5" aria-hidden />
              </span>
            ) : null}
            <Button
              type="button"
              size="sm"
              onClick={onRelease}
              disabled={releaseLoading || releaseDisabled}
            >
              {releaseLoading ? "Releasing…" : "Release"}
            </Button>
          </span>
        ) : null}
        {canMarkReviewed ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onMarkReviewed}
            disabled={markLoading}
          >
            {markLoading ? "Saving…" : "Mark reviewed"}
          </Button>
        ) : null}
      </div>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
