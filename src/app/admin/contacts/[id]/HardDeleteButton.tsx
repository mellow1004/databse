"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type HardDeleteDeletionReason =
  | "dsar_article_17"
  | "retention_lifecycle"
  | "manual_owner_request"
  | "regulatory_order";

const DELETION_OPTIONS: { value: HardDeleteDeletionReason; label: string }[] = [
  { value: "dsar_article_17", label: "DSAR Article 17" },
  { value: "retention_lifecycle", label: "Retention lifecycle" },
  { value: "manual_owner_request", label: "Manual owner request" },
  { value: "regulatory_order", label: "Regulatory order" },
];

export default function HardDeleteButton() {
  const params = useParams();
  const router = useRouter();
  const contactId = params.id as string;

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [deletionReason, setDeletionReason] =
    useState<HardDeleteDeletionReason>("dsar_article_17");
  const [confirmText, setConfirmText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reasonOk = reason.trim().length >= 5;
  const confirmOk = confirmText === "DELETE";
  const canSubmit = reasonOk && confirmOk && !loading;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/contacts/${contactId}/hard-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: reason.trim(),
          deletionReason,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || data.error || `HTTP ${res.status}`);
        return;
      }
      router.push("/admin/quarantine");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function cancel() {
    setOpen(false);
    setReason("");
    setConfirmText("");
    setDeletionReason("dsar_article_17");
    setError(null);
  }

  return (
    <div>
      {!open ? (
        <Button variant="destructive" type="button" onClick={() => setOpen(true)}>
          Hard delete contact
        </Button>
      ) : (
        <form onSubmit={onSubmit} className="max-w-lg space-y-4">
          <div className="space-y-2">
            <Label htmlFor="hd-reason">Reason (required, min 5 characters)</Label>
            <Textarea
              id="hd-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Document why this hard delete is authorised…"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hd-category">Deletion category</Label>
            <Select
              value={deletionReason}
              onValueChange={(v) =>
                setDeletionReason(v as HardDeleteDeletionReason)
              }
            >
              <SelectTrigger id="hd-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DELETION_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="hd-confirm">
              Type <span className="font-mono font-semibold">DELETE</span> to confirm
            </Label>
            <Input
              id="hd-confirm"
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
              className="font-mono"
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="destructive" disabled={!canSubmit}>
              {loading ? "Deleting…" : "Confirm hard delete"}
            </Button>
            <Button type="button" variant="outline" onClick={cancel} disabled={loading}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
