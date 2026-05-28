"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { suppressionRequiresApproval } from "@/lib/suppression-governance";

type Props = {
  suppressionId: string;
  scope: string;
  reasonCode: string;
  isOptOut: boolean;
  releaseStatus: string;
};

export default function ReleaseButton({
  suppressionId,
  scope,
  reasonCode,
  isOptOut,
  releaseStatus,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [openRelease, setOpenRelease] = useState(false);
  const [openApprove, setOpenApprove] = useState(false);
  const [openReject, setOpenReject] = useState(false);
  const [reason, setReason] = useState("");
  const [approvalReason, setApprovalReason] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [regulatoryReviewNotes, setRegulatoryReviewNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const decision = suppressionRequiresApproval({ scope, reasonCode, isOptOut });

  async function callApi(path: string, payload: Record<string, unknown>) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || data.error || `HTTP ${res.status}`);
        return false;
      }
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function onRequestRelease() {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("A non-empty reason is required.");
      return;
    }
    if (isOptOut && !regulatoryReviewNotes.trim()) {
      setError("Regulatory review notes are required for opt-out releases.");
      return;
    }
    const ok = await callApi(`/api/suppressions/${suppressionId}/release`, {
      reason: trimmed,
      regulatoryReviewNotes: regulatoryReviewNotes.trim() || undefined,
    });
    if (ok) {
      setOpenRelease(false);
      setReason("");
      setRegulatoryReviewNotes("");
    }
  }

  async function onDirectRelease() {
    const ok = await callApi(`/api/suppressions/${suppressionId}/release`, {
      reason: "Direct release (non-sensitive suppression)",
    });
    if (ok) {
      setReason("");
      setRegulatoryReviewNotes("");
    }
  }

  async function onApprove() {
    const trimmed = approvalReason.trim();
    if (!trimmed) {
      setError("Approval reason is required.");
      return;
    }
    if (isOptOut && !regulatoryReviewNotes.trim()) {
      setError("Regulatory review notes are required for opt-out releases.");
      return;
    }
    const ok = await callApi(`/api/suppressions/${suppressionId}/approve-release`, {
      approvalReason: trimmed,
      regulatoryReviewNotes: regulatoryReviewNotes.trim() || undefined,
    });
    if (ok) {
      setOpenApprove(false);
      setApprovalReason("");
      setRegulatoryReviewNotes("");
    }
  }

  async function onReject() {
    const trimmed = rejectionReason.trim();
    if (!trimmed) {
      setError("Rejection reason is required.");
      return;
    }
    const ok = await callApi(`/api/suppressions/${suppressionId}/reject-release`, {
      rejectionReason: trimmed,
    });
    if (ok) {
      setOpenReject(false);
      setRejectionReason("");
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      {releaseStatus === "active" ? (
        decision.requiresApproval ? (
          <Dialog open={openRelease} onOpenChange={setOpenRelease}>
            <DialogTrigger asChild>
              <Button type="button" variant="outline" size="sm" disabled={loading}>
                Release
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Request suppression release</DialogTitle>
                <DialogDescription>
                  This suppression requires Data Owner approval before release.
                </DialogDescription>
              </DialogHeader>
              <Textarea
                placeholder="Release reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
              />
              {isOptOut ? (
                <Textarea
                  placeholder="Regulatory review notes (required)"
                  value={regulatoryReviewNotes}
                  onChange={(e) => setRegulatoryReviewNotes(e.target.value)}
                  rows={3}
                />
              ) : null}
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpenRelease(false)}>Cancel</Button>
                <Button onClick={onRequestRelease} disabled={loading}>
                  {loading ? "Submitting…" : "Submit request"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : (
          <Button type="button" variant="outline" size="sm" disabled={loading} onClick={onDirectRelease}>
            {loading ? "Releasing…" : "Release"}
          </Button>
        )
      ) : null}

      {releaseStatus === "request_pending" ? (
        <div className="flex gap-1">
          <Dialog open={openApprove} onOpenChange={setOpenApprove}>
            <DialogTrigger asChild>
              <Button type="button" size="sm">Approve release</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Approve suppression release</DialogTitle>
              </DialogHeader>
              <Textarea
                placeholder="Approval reason"
                value={approvalReason}
                onChange={(e) => setApprovalReason(e.target.value)}
                rows={3}
              />
              {isOptOut ? (
                <Textarea
                  placeholder="Regulatory review notes (required)"
                  value={regulatoryReviewNotes}
                  onChange={(e) => setRegulatoryReviewNotes(e.target.value)}
                  rows={3}
                />
              ) : null}
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpenApprove(false)}>Cancel</Button>
                <Button onClick={onApprove} disabled={loading}>
                  {loading ? "Approving…" : "Approve"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={openReject} onOpenChange={setOpenReject}>
            <DialogTrigger asChild>
              <Button type="button" size="sm" variant="outline">Reject</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Reject release request</DialogTitle>
              </DialogHeader>
              <Textarea
                placeholder="Rejection reason"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                rows={3}
              />
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpenReject(false)}>Cancel</Button>
                <Button variant="destructive" onClick={onReject} disabled={loading}>
                  {loading ? "Rejecting…" : "Reject"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      ) : null}

      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
