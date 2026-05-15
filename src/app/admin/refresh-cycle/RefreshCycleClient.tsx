"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, RotateCw } from "lucide-react";
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

type Props = {
  clients: { id: string; name: string }[];
  pastCycles: RefreshLogRow[];
};

export function RefreshCycleClient({ clients, pastCycles }: Props) {
  const router = useRouter();

  const [clientId, setClientId] = useState("all");
  const [maxContacts, setMaxContacts] = useState(100);
  const [performAnonymisation, setPerformAnonymisation] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [latestResult, setLatestResult] = useState<RefreshCycleResultJson | null>(
    null,
  );
  const [lastRunAnonymisation, setLastRunAnonymisation] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function handleRun() {
    if (
      !window.confirm(
        "Run a refresh cycle now? This will consume mock provider credits and may change contact gate statuses.",
      )
    ) {
      return;
    }

    setIsRunning(true);
    setError(null);
    setLatestResult(null);
    setLastRunAnonymisation(performAnonymisation);

    try {
      const res = await fetch("/api/refresh-cycle/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(clientId !== "all" ? { clientId } : {}),
          maxContacts,
          performAnonymisation,
        }),
      });

      const data = (await res.json()) as RefreshCycleResultJson & { error?: string };

      if (!res.ok) {
        const msg = data.error ?? "Refresh cycle failed";
        setError(msg);
        toast.error(msg);
        return;
      }

      setLatestResult(data);
      toast.success(
        `Cycle complete — ${data.contactsProcessed} contacts processed in ${data.durationSeconds}s`,
      );
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Refresh cycle failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setIsRunning(false);
    }
  }

  const verificationTotal =
    latestResult != null
      ? latestResult.verification.succeeded + latestResult.verification.failed
      : 0;

  return (
    <div className="space-y-6">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Run new refresh cycle</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
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
              <Label htmlFor="refresh-max">Max contacts</Label>
              <Input
                id="refresh-max"
                type="number"
                min={1}
                max={1000}
                value={maxContacts}
                disabled={isRunning}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (!Number.isNaN(n)) setMaxContacts(n);
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
          </div>

          <Button type="button" onClick={handleRun} disabled={isRunning}>
            {isRunning ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Running cycle...
              </>
            ) : (
              <>
                <RotateCw className="size-4" aria-hidden />
                Run refresh cycle
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
        </CardContent>
      </Card>

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
                      <Badge className={refreshLogStatusVariant(row.status)}>
                        {row.status}
                      </Badge>
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
