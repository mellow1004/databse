"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Phone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { OTTO2_OUTCOMES, type Otto2Outcome } from "@/services/otto2";

type Prospect = {
  contactId: string;
  fullName: string;
  phone: string;
  company: string;
  totalCallAttempts: number;
  lastCalledAt: string | null;
};

type CallbackRow = {
  id: string;
  contactId: string;
  fullName: string;
  phone: string | null;
  company: string;
  scheduledFor: string;
  notes: string | null;
};

const OUTCOME_LABELS: Record<Otto2Outcome, string> = {
  no_answer: "No answer",
  callback: "Callback",
  qualified_interview: "Qualified interview",
  decline: "Decline",
  wrong_number: "Wrong number",
  answer_no_interview: "Answer — no interview",
};

function formatWhen(iso: string | null): string {
  if (!iso) return "Never";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function outcomeToast(
  outcome: Otto2Outcome,
  result: { quarantineCreated: boolean; suppressionCreated: boolean },
): string {
  if (outcome === "wrong_number" && result.quarantineCreated) {
    return "Wrong number — contact quarantined";
  }
  if (outcome === "decline" && result.suppressionCreated) {
    return "Decline recorded — opt-out suppression created (2nd decline in 30 days)";
  }
  if (outcome === "callback") return "Callback scheduled";
  if (outcome === "qualified_interview") return "Qualified interview logged";
  if (outcome === "decline") return "Decline recorded";
  if (outcome === "no_answer") return "No answer — call recorded";
  if (outcome === "answer_no_interview") return "Answer (no interview) — call recorded";
  return "Call outcome recorded";
}

type Props = {
  clientId: string;
};

export function Otto2CallingTab({ clientId }: Props) {
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [callbacks, setCallbacks] = useState<CallbackRow[]>([]);
  const [loadingProspects, setLoadingProspects] = useState(false);
  const [loadingCallbacks, setLoadingCallbacks] = useState(false);
  const [recording, setRecording] = useState(false);

  const [selectedContactId, setSelectedContactId] = useState("");
  const [outcome, setOutcome] = useState<Otto2Outcome>("no_answer");
  const [callbackDate, setCallbackDate] = useState("");
  const [notes, setNotes] = useState("");

  const loadProspects = useCallback(async () => {
    setLoadingProspects(true);
    try {
      const res = await fetch(
        `/api/otto2/prospects?clientId=${encodeURIComponent(clientId)}&limit=20`,
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to load prospects");
        return;
      }
      const list = (data.prospects ?? []) as Prospect[];
      setProspects(list);
      setSelectedContactId((prev) => {
        if (list.length === 0) return "";
        if (list.some((p) => p.contactId === prev)) return prev;
        return list[0]!.contactId;
      });
    } finally {
      setLoadingProspects(false);
    }
  }, [clientId]);

  const loadCallbacks = useCallback(async () => {
    setLoadingCallbacks(true);
    try {
      const res = await fetch(
        `/api/otto2/callback-queue?clientId=${encodeURIComponent(clientId)}`,
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to load callback queue");
        return;
      }
      setCallbacks((data.callbacks ?? []) as CallbackRow[]);
    } finally {
      setLoadingCallbacks(false);
    }
  }, [clientId]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadProspects(), loadCallbacks()]);
  }, [loadProspects, loadCallbacks]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  async function recordOutcome() {
    if (!selectedContactId) {
      toast.error("Select a contact from the calling list");
      return;
    }
    if (outcome === "callback" && !callbackDate) {
      toast.error("Callback date is required for callback outcomes");
      return;
    }
    setRecording(true);
    try {
      const res = await fetch("/api/otto2/call-outcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: selectedContactId,
          outcome,
          notes: notes.trim() || undefined,
          callbackScheduledFor:
            outcome === "callback" ? new Date(callbackDate).toISOString() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to record outcome");
        return;
      }
      toast.success(
        outcomeToast(outcome, {
          quarantineCreated: Boolean(data.quarantineCreated),
          suppressionCreated: Boolean(data.suppressionCreated),
        }),
      );
      setNotes("");
      setCallbackDate("");
      await refreshAll();
    } finally {
      setRecording(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Phone className="size-4" aria-hidden />
            Otto 2 read/write contract
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 text-sm">
          <div className="space-y-2">
            <p className="font-medium text-slate-700">Reads</p>
            <ul className="space-y-2 text-slate-600">
              <li>
                <code className="text-xs">GET /api/otto2/prospects?clientId=&amp;limit=</code>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {"{ prospects: [{ contactId, fullName, phone, company, totalCallAttempts, lastCalledAt }] }"}
                </p>
              </li>
              <li>
                <code className="text-xs">GET /api/otto2/callback-queue?clientId=</code>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {"{ callbacks: [{ id, contactId, fullName, scheduledFor, ... }] }"}
                </p>
              </li>
            </ul>
          </div>
          <div className="space-y-2">
            <p className="font-medium text-slate-700">Writes</p>
            <ul className="space-y-2 text-slate-600">
              <li>
                <code className="text-xs">POST /api/otto2/call-outcome</code>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {"{ callId, quarantineCreated, suppressionCreated }"}
                </p>
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Active calling list</h3>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loadingProspects}
            onClick={() => void loadProspects()}
          >
            {loadingProspects ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : null}
            Refresh calling list
          </Button>
        </div>
        <Card className="shadow-sm">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contact</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="text-right">Attempts</TableHead>
                  <TableHead>Last called</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {prospects.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                      {loadingProspects
                        ? "Loading…"
                        : "No phone-verified gate_2 prospects. Refresh or pick another client."}
                    </TableCell>
                  </TableRow>
                ) : (
                  prospects.map((p) => (
                    <TableRow key={p.contactId}>
                      <TableCell>
                        <Link
                          href={`/admin/contacts/${p.contactId}`}
                          className="font-medium text-slate-900 hover:underline"
                        >
                          {p.fullName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">{p.company}</TableCell>
                      <TableCell className="text-xs">{p.phone}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.totalCallAttempts}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatWhen(p.lastCalledAt)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">Callback queue</h3>
        <Card className="shadow-sm">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contact</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Scheduled for</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {callbacks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                      {loadingCallbacks ? "Loading…" : "No pending callbacks."}
                    </TableCell>
                  </TableRow>
                ) : (
                  callbacks.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <Link
                          href={`/admin/contacts/${c.contactId}`}
                          className="font-medium hover:underline"
                        >
                          {c.fullName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">{c.company}</TableCell>
                      <TableCell className="text-xs tabular-nums">
                        {formatWhen(c.scheduledFor)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.notes ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">Simulate call outcome</h3>
        <Card className="shadow-sm">
          <CardContent className="space-y-4 pt-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Contact</Label>
                <Select value={selectedContactId} onValueChange={setSelectedContactId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select from calling list" />
                  </SelectTrigger>
                  <SelectContent>
                    {prospects.map((p) => (
                      <SelectItem key={p.contactId} value={p.contactId}>
                        {p.fullName} · {p.company}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Outcome</Label>
                <Select
                  value={outcome}
                  onValueChange={(v) => setOutcome(v as Otto2Outcome)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OTTO2_OUTCOMES.map((o) => (
                      <SelectItem key={o} value={o}>
                        {OUTCOME_LABELS[o]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {outcome === "callback" ? (
              <div className="space-y-2">
                <Label htmlFor="otto-callback-date">Callback scheduled for</Label>
                <Input
                  id="otto-callback-date"
                  type="datetime-local"
                  value={callbackDate}
                  onChange={(e) => setCallbackDate(e.target.value)}
                />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="otto-notes">Notes (optional)</Label>
              <Textarea
                id="otto-notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Call notes for audit trail…"
              />
            </div>
            <Button
              type="button"
              disabled={recording || prospects.length === 0}
              onClick={() => void recordOutcome()}
            >
              {recording ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              Record outcome
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
