"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export default function BulkApprovalActions({ approvalId }: { approvalId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState<"approve" | "reject" | null>(null);
  const [openApprove, setOpenApprove] = useState(false);
  const [openReject, setOpenReject] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(kind: "approve" | "reject") {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("Reason is required.");
      return;
    }
    setLoading(kind);
    setError(null);
    try {
      const res = await fetch(`/api/bulk-approvals/${approvalId}/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Request failed");
        return;
      }
      setReason("");
      setOpenApprove(false);
      setOpenReject(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex gap-2">
        <Dialog open={openApprove} onOpenChange={setOpenApprove}>
          <DialogTrigger asChild>
            <Button size="sm">Approve</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Approve bulk action</DialogTitle>
            </DialogHeader>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Approval reason" />
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpenApprove(false)}>Cancel</Button>
              <Button onClick={() => submit("approve")} disabled={loading !== null}>
                {loading === "approve" ? "Approving…" : "Approve"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={openReject} onOpenChange={setOpenReject}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">Reject</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reject bulk action</DialogTitle>
            </DialogHeader>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Rejection reason" />
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpenReject(false)}>Cancel</Button>
              <Button variant="destructive" onClick={() => submit("reject")} disabled={loading !== null}>
                {loading === "reject" ? "Rejecting…" : "Reject"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
