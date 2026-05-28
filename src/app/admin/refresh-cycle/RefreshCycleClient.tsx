"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Download, Loader2, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { getStatusVariant } from "@/lib/badge-helpers";
import type {
  RefreshCycleResultJson,
  RefreshLogRow,
} from "@/lib/refresh-cycle-types";

function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  const diffSec = Math.round((d.getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(diffSec, "second");
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");
  const diffHour = Math.round(diffSec / 3600);
  if (Math.abs(diffHour) < 24) return rtf.format(diffHour, "hour");
  const diffDay = Math.round(diffSec / 86400);
  return rtf.format(diffDay, "day");
}

function refreshLogStatusVariant(status: string): string {
  const s = status.toLowerCase();
  if (s === "completed") return getStatusVariant("valid");
  if (s === "in_progress") return getStatusVariant("ready_for_review");
  if (s === "failed") return getStatusVariant("failed");
  return getStatusVariant(status);
}

function formatEur(value: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

type Props = {
  clients: { id: string; name: string }[];
  pastCycles: RefreshLogRow[];
};

export function RefreshCycleClient({ clients, pastCycles }: Props) {
  const router = useRouter();
  const steps = ["Scope", "Preview", "Progress", "Results"] as const;
  const [step, setStep] = useState<(typeof steps)[number]>("Scope");
  const [clientId, setClientId] = useState("all");
  const [maxActiveContacts, setMaxActiveContacts] = useState(100);
  const [maxDormantContacts, setMaxDormantContacts] = useState(50);
  const [maxFrozenContacts, setMaxFrozenContacts] = useState(50);
  const [approvalId, setApprovalId] = useState("");
  const [performAnonymisation, setPerformAnonymisation] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [progressPayload, setProgressPayload] = useState<{
    status: string;
    progress?: {
      contactsProcessed?: number;
      progress?: {
        checkpoints?: Array<{ at: number; total: number; timestamp: string }>;
        failedRecords?: string[];
        skippedRecords?: Array<{ contactId: string; reason: string }>;
        providerOutages?: Array<{ provider: string; durationMs: number }>;
        providerCalls?: Record<string, number>;
      };
    };
  } | null>(null);
  const [preview, setPreview] = useState<{
    scope: { active: number; dormant: number; frozen: number; total: number };
    estimatedCreditsByProvider: Record<string, number>;
    estimatedCostEur: number;
    tierActions: { active: string; dormant: string; frozen: string };
  } | null>(null);
  const [latestResult, setLatestResult] = useState<RefreshCycleResultJson | null>(
    null,
  );
  const [pendingApprovalId, setPendingApprovalId] = useState<string | null>(null);
  const [lastRunAnonymisation, setLastRunAnonymisation] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function handlePreview() {
    setIsPreviewing(true);
    setError(null);
    try {
      const res = await fetch("/api/refresh-cycle/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(clientId !== "all" ? { clientId } : {}),
          maxActiveContacts,
          maxDormantContacts,
          maxFrozenContacts,
        }),
      });
      const data = (await res.json()) as typeof preview & { error?: string };
      if (!res.ok) {
        throw new Error(data?.error ?? "Preview failed");
      }
      setPreview(data);
      setStep("Preview");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Preview failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setIsPreviewing(false);
    }
  }

  async function handleRun() {
    setIsRunning(true);
    setStep("Progress");
    setError(null);
    setLatestResult(null);
    setPendingApprovalId(null);
    setLastRunAnonymisation(performAnonymisation);
    try {
      const res = await fetch("/api/refresh-cycle/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(clientId !== "all" ? { clientId } : {}),
          maxActiveContacts,
          maxDormantContacts,
          maxFrozenContacts,
          performAnonymisation,
          approvalId: approvalId.trim() || undefined,
        }),
      });

      const data = (await res.json()) as RefreshCycleResultJson & { error?: string };

      if (!res.ok) {
        const msg = data.error ?? "Refresh cycle failed";
        setError(msg);
        toast.error(msg);
        return;
      }

      if (data.pendingApprovalId) {
        setPendingApprovalId(data.pendingApprovalId);
        toast.message(`Bulk approval required: ${data.pendingApprovalId}`);
        setStep("Scope");
        return;
      }

      setLatestResult(data);
      setRunId(data.refreshLogId);
      setStep("Results");
      toast.success(
        `Cycle complete — ${data.contactsProcessed} contacts processed in ${data.durationSeconds}s`,
      );
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Refresh cycle failed";
      setError(msg);
      toast.error(msg);
      setStep("Scope");
    } finally {
      setIsRunning(false);
    }
  }

  useEffect(() => {
    if (!runId) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/refresh-cycle/${runId}/progress`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          status: string;
          progress?: RefreshCycleResultJson & {
            progress?: {
              checkpoints?: Array<{ at: number; total: number; timestamp: string }>;
              failedRecords?: string[];
              skippedRecords?: Array<{ contactId: string; reason: string }>;
              providerOutages?: Array<{ provider: string; durationMs: number }>;
              providerCalls?: Record<string, number>;
            };
          };
        };
        setProgressPayload(data);
      } catch {
        // ignore transient polling failures
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [runId]);

  const progressMeta = useMemo(() => {
    const checkpoints = progressPayload?.progress?.progress?.checkpoints ?? [];
    const latestCheckpoint = checkpoints.length ? checkpoints[checkpoints.length - 1] : null;
    const total = latestCheckpoint?.total ?? preview?.scope.total ?? latestResult?.contactsProcessed ?? 0;
    const processed =
      latestResult?.contactsProcessed ??
      latestCheckpoint?.at ??
      progressPayload?.progress?.contactsProcessed ??
      0;
    const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
    return { processed, total, pct, latestCheckpoint };
  }, [latestResult, preview?.scope.total, progressPayload]);

  const verificationTotal =
    latestResult != null
      ? latestResult.verification.succeeded + latestResult.verification.failed
      : 0;

  return (
    <div className="space-y-6">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Refresh cycle wizard</CardTitle>
          <CardDescription>Scope {"->"} Preview {"->"} Progress {"->"} Results</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-4">
            {steps.map((s, idx) => {
              const active = s === step;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStep(s)}
                  className={`rounded-md border px-3 py-2 text-left text-sm ${
                    active ? "border-slate-900 bg-slate-50 font-semibold" : "border-slate-200"
                  }`}
                >
                  <div className="text-xs text-muted-foreground">Step {idx + 1}</div>
                  <div>{s}</div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Scope</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-5">
            <div className="space-y-2">
              <Label htmlFor="refresh-client">Client</Label>
              <Select value={clientId} onValueChange={setClientId} disabled={isRunning}>
                <SelectTrigger id="refresh-client" className="w-full">
                  <SelectValue placeholder="Select client" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All clients</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="refresh-max-active">Max active</Label>
              <Input
                id="refresh-max-active"
                type="number"
                min={1}
                max={5000}
                value={maxActiveContacts}
                disabled={isRunning}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (!Number.isNaN(n)) setMaxActiveContacts(n);
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="refresh-max-dormant">Max dormant</Label>
              <Input
                id="refresh-max-dormant"
                type="number"
                min={0}
                max={5000}
                value={maxDormantContacts}
                disabled={isRunning}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (!Number.isNaN(n)) setMaxDormantContacts(n);
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="refresh-max-frozen">Max frozen</Label>
              <Input
                id="refresh-max-frozen"
                type="number"
                min={0}
                max={5000}
                value={maxFrozenContacts}
                disabled={isRunning}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (!Number.isNaN(n)) setMaxFrozenContacts(n);
                }}
              />
            </div>

            <div className="flex items-end gap-2 pb-2">
              <Checkbox
                id="refresh-anon"
                checked={performAnonymisation}
                disabled={isRunning}
                onCheckedChange={(v) => setPerformAnonymisation(v === true)}
              />
              <Label htmlFor="refresh-anon" className="cursor-pointer font-normal">
                Anonymise stale records
              </Label>
            </div>
            <div className="space-y-2">
              <Label htmlFor="refresh-approval">Approval id (optional)</Label>
              <Input
                id="refresh-approval"
                value={approvalId}
                disabled={isRunning}
                onChange={(e) => setApprovalId(e.target.value)}
                placeholder="cm... (approved bulk action)"
                className="font-mono text-xs"
              />
            </div>
          </div>

          <Button type="button" onClick={handlePreview} disabled={isRunning || isPreviewing}>
            {isPreviewing ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Building preview...
              </>
            ) : (
              <>
                <RotateCw className="size-4" aria-hidden />
                Continue to preview
              </>
            )}
          </Button>

          {isRunning ? (
            <p className="text-xs text-muted-foreground">
              This may take 30–60 seconds depending on the contact count.
            </p>
          ) : null}

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {pendingApprovalId ? (
            <Alert>
              <AlertTitle>Bulk approval required</AlertTitle>
              <AlertDescription>
                Request created: <span className="font-mono text-xs">{pendingApprovalId}</span>. Approve it in
                <span> /admin/bulk-approvals</span> and rerun with that approval id.
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {preview ? (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Preview</CardTitle>
            <CardDescription>
              {preview.scope.active} active, {preview.scope.dormant} dormant, {preview.scope.frozen} frozen (skipped) -
              est cost {formatEur(preview.estimatedCostEur)} - uses{" "}
              {Object.values(preview.estimatedCreditsByProvider).reduce((a, b) => a + b, 0)} credits.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>Active: {preview.tierActions.active}</li>
              <li>Dormant: {preview.tierActions.dormant}</li>
              <li>Frozen: {preview.tierActions.frozen}</li>
            </ul>
            <Button type="button" onClick={handleRun} disabled={isRunning}>
              {isRunning ? "Running..." : "Confirm and run"}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {step === "Progress" || isRunning ? (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Progress</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-3xl font-semibold tabular-nums">
              Processed {progressMeta.processed} of {progressMeta.total} contacts
            </p>
            <div className="h-2 w-full rounded bg-slate-100">
              <div className="h-2 rounded bg-slate-900" style={{ width: `${progressMeta.pct}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">
              {progressMeta.latestCheckpoint
                ? `Checkpoint ${progressMeta.latestCheckpoint.at}/${progressMeta.latestCheckpoint.total}`
                : "Waiting for first checkpoint"}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-sm font-medium">Provider call counts</p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {Object.entries(
                    progressPayload?.progress?.progress?.providerCalls ?? {},
                  ).map(([provider, count]) => (
                    <li key={provider}>
                      {provider}: {count}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-1 text-sm font-medium">Errors / failed records</p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {(progressPayload?.progress?.progress?.failedRecords ?? [])
                    .slice(0, 8)
                    .map((id) => (
                      <li key={id}>{id}</li>
                    ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {latestResult ? (
        <Card className="border-emerald-200 shadow-sm">
          <CardHeader>
            <CardTitle>Latest cycle result</CardTitle>
            <CardDescription>
              Completed in {latestResult.durationSeconds}s — cycle #
              {latestResult.cycleNumber}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <a href={`/api/refresh-cycle/${latestResult.refreshLogId}/export`}>
                  <Download className="size-4" aria-hidden />
                  Export report
                </a>
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  Date.now() - new Date(latestResult.completedAt).getTime() > 24 * 60 * 60 * 1000
                }
                onClick={() => toast.message("Rollback will be enabled in F2.3")}
              >
                Rollback this run
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card className="shadow-none">
                <CardContent className="p-4">
                  <p className="text-2xl font-semibold tabular-nums">
                    {latestResult.verification.succeeded}/{verificationTotal}
                  </p>
                  <p className="text-sm text-muted-foreground">Verified</p>
                  <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                    {Object.entries(latestResult.verification.creditsByProvider)
                      .filter(([, c]) => c > 0)
                      .map(([provider, credits]) => (
                        <p key={provider}>
                          {provider}: {credits} credits
                        </p>
                      ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-none">
                <CardContent className="p-4">
                  <p className="text-2xl font-semibold tabular-nums">
                    {latestResult.enrichment.enriched}
                  </p>
                  <p className="text-sm text-muted-foreground">Enriched</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {latestResult.enrichment.conflictsFlagged} conflicts
                  </p>
                </CardContent>
              </Card>

              <Card className="shadow-none">
                <CardContent className="p-4">
                  <p className="text-lg font-semibold tabular-nums">
                    {latestResult.gates.promoted} promoted
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {latestResult.gates.downgraded} downgraded ·{" "}
                    {latestResult.gates.quarantined} quarantined
                  </p>
                </CardContent>
              </Card>

              {lastRunAnonymisation ? (
                <Card className="shadow-none">
                  <CardContent className="p-4">
                    <p className="text-2xl font-semibold tabular-nums">
                      {latestResult.anonymisation.anonymised}
                    </p>
                    <p className="text-sm text-muted-foreground">Anonymised</p>
                  </CardContent>
                </Card>
              ) : null}
            </div>

            <div>
              <h3 className="mb-2 text-sm font-medium">Cost breakdown</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Provider</TableHead>
                    <TableHead className="text-right">Credits used</TableHead>
                    <TableHead className="text-right">EUR cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {latestResult.costBreakdown.map((row) => (
                    <TableRow key={row.provider}>
                      <TableCell>{row.provider}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.credits}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        €{row.eurCost.toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className="font-semibold">Total</TableCell>
                    <TableCell />
                    <TableCell className="text-right font-semibold tabular-nums">
                      €{latestResult.totalCostEur.toFixed(2)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            {latestResult.errors && latestResult.errors.length > 0 ? (
              <Alert variant="destructive">
                <AlertTitle>Cycle completed with errors</AlertTitle>
                <AlertDescription>
                  <ul className="mt-2 list-inside list-disc space-y-1">
                    {latestResult.errors.map((err, i) => (
                      <li key={`${err.phase}-${i}`}>
                        <span className="font-medium">{err.phase}:</span> {err.message}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Past cycles</CardTitle>
          <CardDescription>Last 10 refresh runs across all clients</CardDescription>
        </CardHeader>
        <CardContent>
          {pastCycles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No past refresh cycles. Run your first cycle above to get started.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cycle #</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead className="text-right">Contacts processed</TableHead>
                  <TableHead className="text-right">Downgraded</TableHead>
                  <TableHead className="text-right">Anonymised</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pastCycles.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-semibold">{row.cycleNumber}</TableCell>
                    <TableCell>{formatRelativeTime(row.startedAt)}</TableCell>
                    <TableCell>{row.durationSeconds}s</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.recordsReVerified}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.recordsDowngraded}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.recordsAnonymised}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      €{(row.costEstimate ?? 0).toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge className={refreshLogStatusVariant(row.status)}>{row.status}</Badge>
                        <Badge variant="outline">
                          {(row.costBreakdown ?? []).length > 0 ? "budget tracked" : "no alerts"}
                        </Badge>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
