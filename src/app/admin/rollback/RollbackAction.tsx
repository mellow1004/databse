"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  batchId: string;
  requiresReview: boolean;
};

export default function RollbackAction({ batchId, requiresReview }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [approveText, setApproveText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("Reason is required.");
      return;
    }
    if (requiresReview && approveText !== "APPROVE") {
      setError('Type "APPROVE" to bypass the review requirement.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/rollback/${batchId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: trimmed,
          allowOverride: requiresReview,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Rollback failed");
        return;
      }
      setOpen(false);
      setReason("");
      setApproveText("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rollback failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">Rollback</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rollback batch</DialogTitle>
        </DialogHeader>
        {requiresReview ? (
          <p className="text-sm text-amber-700">
            Requires GTME Ops Manager review - type APPROVE to bypass.
          </p>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="rollback-reason">Reason</Label>
          <Textarea
            id="rollback-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why are you restoring this batch?"
          />
        </div>
        {requiresReview ? (
          <div className="space-y-2">
            <Label htmlFor="rollback-approve">Override confirmation</Label>
            <Input
              id="rollback-approve"
              value={approveText}
              onChange={(e) => setApproveText(e.target.value)}
              placeholder='Type "APPROVE"'
            />
          </div>
        ) : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="destructive" onClick={submit} disabled={loading}>
            {loading ? "Rolling back..." : "Confirm rollback"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
