"use client";

import { UserX } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  getConfidenceTierVariant,
  getDedupTypeVariant,
} from "@/lib/badge-helpers";
import type { DedupCandidate } from "@/services/dedup";
import {
  CONTACT_OVERRIDEABLE_FIELDS,
  COMPANY_OVERRIDEABLE_FIELDS,
} from "@/services/merge";

type FilterType = "all" | "contact" | "company";

const THRESHOLDS = [0.5, 0.7, 0.85, 0.95] as const;

type Props = {
  candidates: DedupCandidate[];
  clients: { id: string; name: string }[];
  currentClientId: string;
  currentMinConfidence: number;
  currentType: FilterType;
};

function shortId(id: string): string {
  return id.slice(-8);
}

function maybeShort(id: string | null | undefined): string {
  return id ? shortId(id) : "—";
}

export default function DedupReviewer({
  candidates,
  clients,
  currentClientId,
  currentMinConfidence,
  currentType,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [removedKeys, setRemovedKeys] = useState<Set<string>>(new Set());

  function buildUrl(p: {
    clientId?: string;
    minConfidence?: string;
    type?: string;
  }) {
    const sp = new URLSearchParams();
    sp.set("clientId", p.clientId ?? currentClientId);
    sp.set(
      "minConfidence",
      p.minConfidence ?? String(currentMinConfidence),
    );
    sp.set("type", p.type ?? currentType);
    return `/admin/dedup?${sp.toString()}`;
  }

  function navigate(url: string) {
    startTransition(() => {
      router.push(url);
    });
  }

  function keyOf(c: DedupCandidate): string {
    return `${c.type}::${c.survivorId}::${c.mergedFromId}`;
  }

  const visible = candidates.filter((c) => !removedKeys.has(keyOf(c)));
  const pct = Math.round(currentMinConfidence * 100);

  return (
    <div className="space-y-4">
      <Card className="sticky top-0 z-10 shadow-sm">
        <CardContent className="flex flex-col gap-4 pt-6">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label>Client</Label>
              <Select
                value={currentClientId}
                onValueChange={(v) => navigate(buildUrl({ clientId: v }))}
                disabled={isPending}
              >
                <SelectTrigger className="w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Confidence threshold</Label>
              <Select
                value={String(currentMinConfidence)}
                onValueChange={(v) =>
                  navigate(buildUrl({ minConfidence: v }))
                }
                disabled={isPending}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {THRESHOLDS.map((t) => (
                    <SelectItem key={t} value={String(t)}>
                      {Math.round(t * 100)}%
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Tabs
                value={currentType}
                onValueChange={(v) =>
                  navigate(buildUrl({ type: v as FilterType }))
                }
              >
                <TabsList>
                  <TabsTrigger value="all" disabled={isPending}>
                    All
                  </TabsTrigger>
                  <TabsTrigger value="contact" disabled={isPending}>
                    Contacts
                  </TabsTrigger>
                  <TabsTrigger value="company" disabled={isPending}>
                    Companies
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="all" className="hidden" />
                <TabsContent value="contact" className="hidden" />
                <TabsContent value="company" className="hidden" />
              </Tabs>
            </div>
          </div>
          <p className="text-sm text-slate-600">
            <span className="font-semibold text-slate-900">{visible.length}</span>{" "}
            candidate{visible.length === 1 ? "" : "s"} at confidence ≥{" "}
            <span className="tabular-nums font-medium">{pct}%</span>
          </p>
        </CardContent>
      </Card>

      {visible.length === 0 ? (
        <Card className="shadow-sm">
          <CardContent className="flex flex-col items-center justify-center gap-4 py-16 text-center">
            <UserX className="size-12 text-slate-300" aria-hidden />
            <p className="text-sm text-slate-600">
              No duplicate candidates at this confidence threshold.
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={isPending || currentMinConfidence <= 0.5}
              onClick={() => navigate(buildUrl({ minConfidence: "0.5" }))}
            >
              Lower threshold to 50%
            </Button>
          </CardContent>
        </Card>
      ) : (
        visible.map((c) => (
          <CandidateCard
            key={keyOf(c)}
            candidate={c}
            onMerged={() => {
              setRemovedKeys((prev) => new Set(prev).add(keyOf(c)));
              router.refresh();
            }}
            onDismissed={() => {
              setRemovedKeys((prev) => new Set(prev).add(keyOf(c)));
            }}
          />
        ))
      )}
    </div>
  );
}

function CandidateCard({
  candidate,
  onMerged,
  onDismissed,
}: {
  candidate: DedupCandidate;
  onMerged: () => void;
  onDismissed: () => void;
}) {
  const router = useRouter();
  const overrideable =
    candidate.type === "contact"
      ? CONTACT_OVERRIDEABLE_FIELDS
      : COMPANY_OVERRIDEABLE_FIELDS;

  const [reason, setReason] = useState("");
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onApprove() {
    if (!reason.trim()) {
      setError("Please provide a reason before merging.");
      return;
    }
    const ok = window.confirm(
      `Merge this ${candidate.type}? The merged-from record will be soft-archived (mergedIntoId set), not deleted.`,
    );
    if (!ok) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/dedup/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: candidate.type,
          clientId: candidate.clientId,
          survivorId: candidate.survivorId,
          mergedFromId: candidate.mergedFromId,
          fieldOverrides: overrides,
          reason: reason.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || data.error || `HTTP ${res.status}`);
      } else {
        const rollbackBatchId = data.rollbackBatchId as string | undefined;
        if (rollbackBatchId) {
          toast.success("Merge complete.", {
            action: {
              label: "Undo →",
              onClick: () => router.push(`/admin/rollback?batchId=${encodeURIComponent(rollbackBatchId)}`),
            },
          });
        } else {
          toast.success("Merge complete.");
        }
        onMerged();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={getDedupTypeVariant(candidate.type)}>
            {candidate.type}
          </Badge>
          <Badge className={getConfidenceTierVariant(candidate.confidence)}>
            {Math.round(candidate.confidence * 100)}% confidence
          </Badge>
        </div>
        <p className="text-sm italic text-muted-foreground">{candidate.matchReason}</p>
        <p className="w-full text-xs text-muted-foreground">
          Survivor:{" "}
          <Link
            href={
              candidate.type === "company"
                ? `/admin/companies/${candidate.survivorId}`
                : `/admin/contacts/${candidate.survivorId}`
            }
            className="underline underline-offset-4"
          >
            ...{candidate.survivorId.slice(-8)}
          </Link>{" "}
          · Merged from:{" "}
          <Link
            href={
              candidate.type === "company"
                ? `/admin/companies/${candidate.mergedFromId}`
                : `/admin/contacts/${candidate.mergedFromId}`
            }
            className="underline underline-offset-4"
          >
            ...{candidate.mergedFromId.slice(-8)}
          </Link>
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">Field</TableHead>
              <TableHead>Survivor</TableHead>
              <TableHead>Merged from</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Verified</TableHead>
              <TableHead className="w-56">Take from →</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {candidate.fieldComparison.map((fc) => {
              const canOverride = overrideable.has(fc.field);
              const valuesEqual =
                (fc.survivorValue ?? null) === (fc.mergedFromValue ?? null);
              const disabled = !canOverride || valuesEqual;
              const taking = overrides[fc.field] === true;

              return (
                <TableRow key={fc.field}>
                  <TableCell className="font-mono text-xs">{fc.field}</TableCell>
                  <TableCell
                    className={
                      !taking && canOverride && !valuesEqual ? "font-medium" : ""
                    }
                  >
                    {fmt(fc.survivorValue)}
                  </TableCell>
                  <TableCell className={taking ? "font-medium" : ""}>
                    {fmt(fc.mergedFromValue)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {fc.source ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {fc.verified ?? "—"}
                  </TableCell>
                  <TableCell>
                    {disabled ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        <Button
                          type="button"
                          variant={!taking ? "default" : "outline"}
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() =>
                            setOverrides((p) => ({ ...p, [fc.field]: false }))
                          }
                        >
                          Keep survivor
                        </Button>
                        <Button
                          type="button"
                          variant={taking ? "default" : "outline"}
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() =>
                            setOverrides((p) => ({ ...p, [fc.field]: true }))
                          }
                        >
                          Use merged-from
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        <div className="space-y-2">
          <Label htmlFor={`merge-reason-${candidate.survivorId}`}>
            Merge reason (logged in merge_history)
          </Label>
          <Textarea
            id={`merge-reason-${candidate.survivorId}`}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Why this merge?"
            disabled={submitting}
            rows={2}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={onApprove} disabled={submitting}>
            {submitting ? "Merging…" : "Approve and merge"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={onDismissed}
            disabled={submitting}
          >
            Dismiss
          </Button>
          {error ? (
            <span className="text-sm text-destructive">Error: {error}</span>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          person_id: {maybeShort(candidate.entityIds?.personId)} · contact_id: {maybeShort(candidate.entityIds?.contactId)} · company_id: {maybeShort(candidate.entityIds?.companyId)}
        </p>
      </CardContent>
    </Card>
  );
}

function fmt(v: string | null): string {
  if (v == null || v === "") return "—";
  return v;
}
