"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

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
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [releaseReason, setReleaseReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const releaseDisabled = mergedIntoId !== null;
  const canMarkReviewed = reviewState === "pending";
  const canRelease = reviewState === "pending" || reviewState === "reviewed";

  async function onRelease() {
    if (releaseDisabled) return;
    const trimmed = releaseReason.trim();
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
      setReleaseOpen(false);
      setReleaseReason("");
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
            <Dialog open={releaseOpen} onOpenChange={setReleaseOpen}>
              <DialogTrigger asChild>
                <Button type="button" size="sm" disabled={releaseLoading || releaseDisabled}>
                  {releaseLoading ? "Releasing…" : "Release"}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Approve quarantine release</DialogTitle>
                </DialogHeader>
                <Textarea
                  value={releaseReason}
                  onChange={(e) => setReleaseReason(e.target.value)}
                  placeholder="Approval reason"
                  rows={3}
                />
                <DialogFooter>
                  <Button variant="outline" onClick={() => setReleaseOpen(false)}>Cancel</Button>
                  <Button onClick={onRelease} disabled={releaseLoading}>
                    {releaseLoading ? "Releasing…" : "Approve release"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
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
