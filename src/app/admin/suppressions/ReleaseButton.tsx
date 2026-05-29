"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { suppressionRequiresApproval } from "@/lib/suppression-governance";

type Props = {
  suppressionId: string;
  scope: string;
  reasonCode: string;
  isOptOut: boolean;
  releaseStatus: string;
};

type ScopeSummary = {
  summaryText: string;
  approximateContactCount: number;
};

function SensitiveReleaseFields({
  isOptOut,
  reason,
  onReasonChange,
  regulatoryReviewReference,
  onRegulatoryChange,
  scopeSummary,
  scopeLoading,
  complianceConfirmed,
  onComplianceChange,
}: {
  isOptOut: boolean;
  reason: string;
  onReasonChange: (v: string) => void;
  regulatoryReviewReference: string;
  onRegulatoryChange: (v: string) => void;
  scopeSummary: ScopeSummary | null;
  scopeLoading: boolean;
  complianceConfirmed: boolean;
  onComplianceChange: (v: boolean) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="release-reason">Reason for release</Label>
        <Textarea
          id="release-reason"
          placeholder="Document why this suppression should be released"
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          rows={3}
        />
      </div>
      {isOptOut ? (
        <div className="space-y-2">
          <Label htmlFor="regulatory-ref">Regulatory review reference</Label>
          <Input
            id="regulatory-ref"
            placeholder="e.g. GDPR Article 21 review #2026-0042"
            value={regulatoryReviewReference}
            onChange={(e) => onRegulatoryChange(e.target.value)}
          />
        </div>
      ) : null}
      <div className="rounded-md border bg-muted/40 p-3 text-sm">
        <p className="font-medium text-foreground">Affected scope (approximate)</p>
        {scopeLoading ? (
          <p className="mt-1 text-muted-foreground">Computing scope…</p>
        ) : scopeSummary ? (
          <p className="mt-1 text-muted-foreground">{scopeSummary.summaryText}</p>
        ) : (
          <p className="mt-1 text-muted-foreground">Scope unavailable</p>
        )}
      </div>
      <div className="flex items-start gap-2">
        <Checkbox
          id="compliance-confirm"
          checked={complianceConfirmed}
          onCheckedChange={(v) => onComplianceChange(v === true)}
        />
        <Label htmlFor="compliance-confirm" className="cursor-pointer text-sm leading-snug">
          I confirm this release has been reviewed for regulatory compliance
        </Label>
      </div>
    </div>
  );
}

function useScopeSummary(suppressionId: string, open: boolean) {
  const [scopeSummary, setScopeSummary] = useState<ScopeSummary | null>(null);
  const [scopeLoading, setScopeLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setScopeLoading(true);
    fetch(`/api/suppressions/${suppressionId}/release-scope`)
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as ScopeSummary;
      })
      .then((data) => {
        if (!cancelled) setScopeSummary(data);
      })
      .finally(() => {
        if (!cancelled) setScopeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [suppressionId, open]);

  return { scopeSummary, scopeLoading };
}

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
  const [regulatoryReviewReference, setRegulatoryReviewReference] = useState("");
  const [complianceConfirmed, setComplianceConfirmed] = useState(false);
  const [approveComplianceConfirmed, setApproveComplianceConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decision = suppressionRequiresApproval({ scope, reasonCode, isOptOut });
  const { scopeSummary, scopeLoading } = useScopeSummary(suppressionId, openRelease || openApprove);

  function resetSensitiveFields() {
    setReason("");
    setApprovalReason("");
    setRegulatoryReviewReference("");
    setComplianceConfirmed(false);
    setApproveComplianceConfirmed(false);
    setError(null);
  }

  function canSubmitSensitive(reasonText: string, confirmed: boolean): boolean {
    if (!reasonText.trim()) return false;
    if (isOptOut && !regulatoryReviewReference.trim()) return false;
    if (!confirmed) return false;
    return true;
  }

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
    if (!canSubmitSensitive(trimmed, complianceConfirmed)) {
      setError("Complete all required fields and confirm regulatory compliance.");
      return;
    }
    const ok = await callApi(`/api/suppressions/${suppressionId}/release`, {
      reason: trimmed,
      regulatoryReviewReference: regulatoryReviewReference.trim() || undefined,
      confirmationChecked: true,
    });
    if (ok) {
      setOpenRelease(false);
      resetSensitiveFields();
    }
  }

  async function onDirectRelease() {
    const ok = await callApi(`/api/suppressions/${suppressionId}/release`, {
      reason: "Direct release (non-sensitive suppression)",
    });
    if (ok) resetSensitiveFields();
  }

  async function onApprove() {
    const trimmed = approvalReason.trim();
    if (!canSubmitSensitive(trimmed, approveComplianceConfirmed)) {
      setError("Complete all required fields and confirm regulatory compliance.");
      return;
    }
    const ok = await callApi(`/api/suppressions/${suppressionId}/approve-release`, {
      approvalReason: trimmed,
      regulatoryReviewReference: regulatoryReviewReference.trim() || undefined,
      confirmationChecked: true,
    });
    if (ok) {
      setOpenApprove(false);
      resetSensitiveFields();
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

  const releaseSubmitEnabled =
    canSubmitSensitive(reason, complianceConfirmed) && !loading && !scopeLoading;

  const approveSubmitEnabled =
    canSubmitSensitive(approvalReason, approveComplianceConfirmed) && !loading && !scopeLoading;

  return (
    <div className="flex flex-col items-start gap-1">
      {releaseStatus === "active" ? (
        decision.requiresApproval ? (
          <Dialog
            open={openRelease}
            onOpenChange={(open) => {
              setOpenRelease(open);
              if (!open) resetSensitiveFields();
            }}
          >
            <DialogTrigger asChild>
              <Button type="button" variant="outline" size="sm" disabled={loading}>
                Release
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Request suppression release</DialogTitle>
                <DialogDescription>
                  Sensitive suppression — requires Data Owner approval. Complete all fields
                  before submitting.
                </DialogDescription>
              </DialogHeader>
              <SensitiveReleaseFields
                isOptOut={isOptOut}
                reason={reason}
                onReasonChange={setReason}
                regulatoryReviewReference={regulatoryReviewReference}
                onRegulatoryChange={setRegulatoryReviewReference}
                scopeSummary={scopeSummary}
                scopeLoading={scopeLoading}
                complianceConfirmed={complianceConfirmed}
                onComplianceChange={setComplianceConfirmed}
              />
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpenRelease(false)}>
                  Cancel
                </Button>
                <Button onClick={onRequestRelease} disabled={!releaseSubmitEnabled}>
                  {loading ? "Submitting…" : "Submit request"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={onDirectRelease}
          >
            {loading ? "Releasing…" : "Release"}
          </Button>
        )
      ) : null}

      {releaseStatus === "request_pending" ? (
        <div className="flex gap-1">
          <Dialog
            open={openApprove}
            onOpenChange={(open) => {
              setOpenApprove(open);
              if (!open) resetSensitiveFields();
            }}
          >
            <DialogTrigger asChild>
              <Button type="button" size="sm">
                Approve release
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Approve suppression release</DialogTitle>
                <DialogDescription>
                  Confirm regulatory review before releasing this suppression.
                </DialogDescription>
              </DialogHeader>
              <SensitiveReleaseFields
                isOptOut={isOptOut}
                reason={approvalReason}
                onReasonChange={setApprovalReason}
                regulatoryReviewReference={regulatoryReviewReference}
                onRegulatoryChange={setRegulatoryReviewReference}
                scopeSummary={scopeSummary}
                scopeLoading={scopeLoading}
                complianceConfirmed={approveComplianceConfirmed}
                onComplianceChange={setApproveComplianceConfirmed}
              />
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpenApprove(false)}>
                  Cancel
                </Button>
                <Button onClick={onApprove} disabled={!approveSubmitEnabled}>
                  {loading ? "Approving…" : "Approve release"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={openReject} onOpenChange={setOpenReject}>
            <DialogTrigger asChild>
              <Button type="button" size="sm" variant="outline">
                Reject
              </Button>
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
                <Button variant="outline" onClick={() => setOpenReject(false)}>
                  Cancel
                </Button>
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
