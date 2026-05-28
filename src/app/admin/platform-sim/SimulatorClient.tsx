"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  Info,
  Loader2,
  MailX,
  MessageSquareCheck,
  MessageSquareX,
  Search,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  ActiveCampaignRow,
  RecentSimulatorEvent,
  TargetingContactRow,
} from "./types";

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

function parseComma(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function normalizeCountryCodes(s: string): string[] {
  return parseComma(s)
    .map((c) => c.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2))
    .filter((c) => c.length === 2);
}

type Props = {
  clients: { id: string; name: string }[];
  selectedClientId: string;
  initialActiveCount: number;
  suppressionsTodayAiSdr: number;
  activeCampaign: ActiveCampaignRow[];
  recentEvents: RecentSimulatorEvent[];
};

type ConfirmKind = "bounce" | "stop" | "positive" | null;

export function SimulatorClient({
  clients,
  selectedClientId,
  initialActiveCount,
  suppressionsTodayAiSdr,
  activeCampaign: activeCampaignProp,
  recentEvents,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [tab, setTab] = useState("target");
  const [countriesStr, setCountriesStr] = useState("");
  const [industriesStr, setIndustriesStr] = useState("");
  const [minFreshness, setMinFreshness] = useState("90");
  const [limitStr, setLimitStr] = useState("50");
  const [excludeInCampaign, setExcludeInCampaign] = useState(true);
  const [gates, setGates] = useState({
    gate_1: false,
    gate_2: true,
    gate_3: false,
  });

  const [targetingResults, setTargetingResults] = useState<TargetingContactRow[] | null>(
    null,
  );
  const [eligibleTitle, setEligibleTitle] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [campaignLabel, setCampaignLabel] = useState("");
  const [loadingTargeting, setLoadingTargeting] = useState(false);
  const [loadingAssign, setLoadingAssign] = useState(false);
  const [actionContactId, setActionContactId] = useState<string | null>(null);
  const [confirmKind, setConfirmKind] = useState<ConfirmKind>(null);
  const [loadingEvent, setLoadingEvent] = useState(false);

  const clientFromUrl =
    searchParams.get("clientId") &&
    clients.some((c) => c.id === searchParams.get("clientId"))
      ? searchParams.get("clientId")!
      : selectedClientId;

  const refresh = useCallback(() => {
    startTransition(() => {
      router.refresh();
    });
  }, [router]);

  function setClientId(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("clientId", id);
    router.replace(`/admin/platform-sim?${params.toString()}`);
  }

  async function buildList() {
    setLoadingTargeting(true);
    setSelectedIds(new Set());
    try {
      const gateList: Array<"gate_1" | "gate_2" | "gate_3"> = [];
      if (gates.gate_1) gateList.push("gate_1");
      if (gates.gate_2) gateList.push("gate_2");
      if (gates.gate_3) gateList.push("gate_3");
      const gatesPayload = gateList.length ? gateList : (["gate_2"] as const);

      const countries = countriesStr.trim()
        ? normalizeCountryCodes(countriesStr)
        : undefined;
      const excludeIndustries = industriesStr.trim()
        ? parseComma(industriesStr)
        : undefined;
      const minFreshnessDays = minFreshness.trim()
        ? Math.max(0, Number(minFreshness) || 0)
        : undefined;
      const limit = Math.min(500, Math.max(1, Number(limitStr) || 50));

      const res = await fetch("/api/ai-sdr/targeting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: clientFromUrl,
          gates: gatesPayload,
          countries: countries?.length ? countries : undefined,
          excludeIndustries: excludeIndustries?.length ? excludeIndustries : undefined,
          minFreshnessDays,
          excludeCampaignActive: excludeInCampaign,
          limit,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Targeting failed");
        setTargetingResults(null);
        setEligibleTitle(null);
        return;
      }
      setTargetingResults(data.contacts as TargetingContactRow[]);
      setEligibleTitle(
        `${data.totalEligible} eligible contact(s) — showing ${data.returned}`,
      );
    } finally {
      setLoadingTargeting(false);
    }
  }

  const rows = targetingResults ?? [];
  const allSelected =
    rows.length > 0 && rows.every((r) => selectedIds.has(r.contactId));

  function toggleSelectAll(checked: boolean) {
    if (checked) {
      setSelectedIds(new Set(rows.map((r) => r.contactId)));
    } else {
      setSelectedIds(new Set());
    }
  }

  function toggleRow(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function assignCampaign() {
    const ids = [...selectedIds];
    const label = campaignLabel.trim();
    if (ids.length === 0 || !label) return;
    setLoadingAssign(true);
    try {
      const res = await fetch("/api/ai-sdr/campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds: ids, campaignLabel: label }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Assignment failed");
        return;
      }
      toast.success(
        `${data.assigned} contacts assigned to '${label}'`,
      );
      setSelectedIds(new Set());
      setCampaignLabel("");
      setTab("campaign");
      refresh();
    } finally {
      setLoadingAssign(false);
    }
  }

  async function runConfirmedEvent() {
    if (!actionContactId || !confirmKind) return;
    setLoadingEvent(true);
    try {
      if (confirmKind === "bounce") {
        const res = await fetch("/api/ai-sdr/bounce", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contactId: actionContactId,
            bounceType: "hard",
            bounceReason: "Mailbox not found",
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error ?? "Bounce failed");
          return;
        }
        toast.success(
          data.escalated
            ? "Bounce registered. This is the 3rd hard bounce in 30 days — contact escalated to suppression."
            : "Bounce registered. Contact downgraded to gate_1 and quarantined.",
        );
      } else if (confirmKind === "stop") {
        const res = await fetch("/api/ai-sdr/reply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contactId: actionContactId,
            replyType: "stop",
            replyText: "Please remove me from this list",
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error ?? "Reply failed");
          return;
        }
        toast.success("STOP reply registered. Opt-out suppression created.");
      } else if (confirmKind === "positive") {
        const res = await fetch("/api/ai-sdr/reply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contactId: actionContactId,
            replyType: "positive",
            replyText: "Interested — let's talk next week",
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error ?? "Reply failed");
          return;
        }
        toast.success("Positive reply logged. Campaign deactivated.");
      }
      setConfirmKind(null);
      setActionContactId(null);
      refresh();
    } finally {
      setLoadingEvent(false);
    }
  }

  const confirmCopy = useMemo(() => {
    if (confirmKind === "bounce")
      return {
        title: "Register hard bounce?",
        description:
          "This simulates a hard bounce from the AI SDR platform. The contact will be downgraded to gate_1, quarantined, and removed from the active campaign list.",
      };
    if (confirmKind === "stop")
      return {
        title: "Register STOP reply?",
        description:
          "This creates an opt-out suppression (stop_reply) and ends the campaign for this contact.",
      };
    if (confirmKind === "positive")
      return {
        title: "Register positive reply?",
        description:
          "This logs a positive reply and deactivates the campaign for this contact.",
      };
    return { title: "", description: "" };
  }, [confirmKind]);

  function eventBadge(action: string, afterState: string | null): { label: string; className: string } {
    if (action === "campaign_assigned") {
      return {
        label: "Campaign assigned",
        className: "border-transparent bg-blue-100 text-blue-800",
      };
    }
    if (action === "bounce_event_received") {
      return {
        label: "Bounce",
        className: "border-transparent bg-rose-100 text-rose-800",
      };
    }
    if (action === "reply_event_received") {
      let replyType: string | null = null;
      if (afterState) {
        try {
          replyType = (JSON.parse(afterState) as { replyType?: string }).replyType ?? null;
        } catch {
          /* ignore */
        }
      }
      const positive = replyType === "positive";
      return {
        label: positive ? "Reply · positive" : `Reply · ${replyType ?? "event"}`,
        className: positive
          ? "border-transparent bg-emerald-100 text-emerald-800"
          : "border-transparent bg-amber-100 text-amber-800",
      };
    }
    return { label: action, className: "border-transparent bg-slate-100 text-slate-700" };
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-6 text-sm text-slate-600">
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Active in campaigns (all clients)
          </span>
          <p className="text-lg font-semibold tabular-nums text-slate-900">
            {initialActiveCount}
          </p>
        </div>
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
            AI SDR suppressions today
          </span>
          <p className="text-lg font-semibold tabular-nums text-slate-900">
            {suppressionsTodayAiSdr}
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="grid w-full max-w-xl grid-cols-3">
          <TabsTrigger value="target">Build targeting list</TabsTrigger>
          <TabsTrigger value="campaign">Active campaign</TabsTrigger>
          <TabsTrigger value="events">Recent events</TabsTrigger>
        </TabsList>

        <TabsContent value="target" className="space-y-4">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle>Filters</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Client</Label>
                  <Select value={clientFromUrl} onValueChange={setClientId}>
                    <SelectTrigger className="w-full">
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
                  <Label>Gates</Label>
                  {(["gate_1", "gate_2", "gate_3"] as const).map((g) => (
                    <label
                      key={g}
                      className="flex cursor-pointer items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={gates[g]}
                        onCheckedChange={(v) =>
                          setGates((prev) => ({ ...prev, [g]: v === true }))
                        }
                      />
                      <span>{g}</span>
                    </label>
                  ))}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="countries">Countries (comma-separated ISO codes)</Label>
                  <Input
                    id="countries"
                    placeholder="SE, NO, DK"
                    value={countriesStr}
                    onChange={(e) => setCountriesStr(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="industries">Exclude industries (comma-separated)</Label>
                  <Input
                    id="industries"
                    placeholder="Finance, Insurance"
                    value={industriesStr}
                    onChange={(e) => setIndustriesStr(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fresh">Min freshness days</Label>
                  <Input
                    id="fresh"
                    type="number"
                    min={0}
                    value={minFreshness}
                    onChange={(e) => setMinFreshness(e.target.value)}
                  />
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={excludeInCampaign}
                    onCheckedChange={(v) => setExcludeInCampaign(v === true)}
                  />
                  <span>Exclude already in campaign</span>
                </label>
                <div className="space-y-2">
                  <Label htmlFor="limit">Limit</Label>
                  <Input
                    id="limit"
                    type="number"
                    min={1}
                    max={500}
                    value={limitStr}
                    onChange={(e) => setLimitStr(e.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  className="gap-2"
                  onClick={() => void buildList()}
                  disabled={loadingTargeting || !clientFromUrl}
                >
                  {loadingTargeting ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Search className="size-4" aria-hidden />
                  )}
                  Build list
                </Button>
              </CardContent>
            </Card>

            <Card className="flex flex-col shadow-sm">
              <CardHeader>
                <CardTitle>
                  {eligibleTitle ?? "Build a list to see results"}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-0 p-0">
                {loadingTargeting ? (
                  <div className="space-y-2 p-6">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                ) : targetingResults === null ? (
                  <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-muted-foreground">
                    <Search className="size-10 opacity-50" aria-hidden />
                    <p className="text-sm">Use filters and click &quot;Build list&quot;.</p>
                  </div>
                ) : rows.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-muted-foreground">
                    <Search className="size-10 opacity-50" aria-hidden />
                    <p className="text-sm">No contacts matched these filters.</p>
                  </div>
                ) : (
                  <>
                    <div className="max-h-[min(420px,50vh)] overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10">
                              <Checkbox
                                checked={allSelected}
                                onCheckedChange={(v) => toggleSelectAll(v === true)}
                                aria-label="Select all"
                              />
                            </TableHead>
                            <TableHead>Contact</TableHead>
                            <TableHead>Company</TableHead>
                            <TableHead>Gate</TableHead>
                            <TableHead>Country</TableHead>
                            <TableHead>Last verified</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rows.map((r) => (
                            <TableRow key={r.contactId}>
                              <TableCell>
                                <Checkbox
                                  checked={selectedIds.has(r.contactId)}
                                  onCheckedChange={(v) =>
                                    toggleRow(r.contactId, v === true)
                                  }
                                  aria-label={`Select ${r.fullName}`}
                                />
                              </TableCell>
                              <TableCell>
                                <div className="font-medium">{r.fullName}</div>
                                <div className="text-xs text-muted-foreground break-all">
                                  {r.email ?? "—"}
                                </div>
                              </TableCell>
                              <TableCell className="text-sm">{r.companyName}</TableCell>
                              <TableCell>
                                <code className="text-xs">{r.gateStatus}</code>
                              </TableCell>
                              <TableCell className="text-sm">{r.country ?? "—"}</TableCell>
                              <TableCell className="text-xs tabular-nums text-muted-foreground">
                                {r.lastVerifiedAt
                                  ? formatRelativeTime(
                                      typeof r.lastVerifiedAt === "string"
                                        ? r.lastVerifiedAt
                                        : new Date(r.lastVerifiedAt).toISOString(),
                                    )
                                  : "—"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <div className="sticky bottom-0 border-t bg-card p-4 shadow-[0_-4px_12px_rgba(0,0,0,0.04)]">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                        <p className="text-sm text-muted-foreground">
                          Selected:{" "}
                          <span className="font-semibold text-foreground">
                            {selectedIds.size}
                          </span>
                        </p>
                        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:max-w-md">
                          <Input
                            placeholder="Campaign label, e.g. Q2 Nordic Outreach"
                            value={campaignLabel}
                            onChange={(e) => setCampaignLabel(e.target.value)}
                          />
                          <Button
                            type="button"
                            className="gap-2 sm:self-start"
                            disabled={
                              selectedIds.size === 0 ||
                              !campaignLabel.trim() ||
                              loadingAssign
                            }
                            onClick={() => void assignCampaign()}
                          >
                            {loadingAssign ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Send className="size-4" aria-hidden />
                            )}
                            Assign {selectedIds.size} to campaign
                          </Button>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="campaign" className="space-y-4">
          <div>
            <p className="text-3xl font-semibold tabular-nums text-slate-900">
              {pending ? "…" : activeCampaignProp.length}
            </p>
            <p className="text-sm text-slate-600">
              Currently in active sequences for this client. Trigger inbound events
              below to see the master database react in real time.
            </p>
          </div>
          <Card className="shadow-sm">
            <CardContent className="p-0">
              {activeCampaignProp.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-muted-foreground">
                  <Info className="size-10 opacity-50" aria-hidden />
                  <p className="max-w-md text-sm">
                    No active campaigns. Build a targeting list and assign contacts to
                    see them here.
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Contact</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Gate</TableHead>
                      <TableHead>Last verified</TableHead>
                      <TableHead className="w-44">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeCampaignProp.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          <div className="font-medium">{row.fullName}</div>
                              <div>
                                <Link href={`/admin/contacts/${row.id}`} className="text-xs underline underline-offset-4">
                                  Open contact
                                </Link>
                              </div>
                          <div className="text-xs text-muted-foreground break-all">
                            {row.email ?? "—"}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{row.companyName}</TableCell>
                        <TableCell>
                          <code className="text-xs">{row.gateStatus}</code>
                        </TableCell>
                        <TableCell className="text-xs tabular-nums text-muted-foreground">
                          {row.lastVerifiedAt
                            ? formatRelativeTime(row.lastVerifiedAt)
                            : "—"}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="outline" size="sm" className="gap-1">
                                Simulate event
                                <ChevronDown className="size-3.5" aria-hidden />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                className="gap-2"
                                onSelect={() => {
                                  setActionContactId(row.id);
                                  setConfirmKind("bounce");
                                }}
                              >
                                <MailX className="size-3.5" aria-hidden />
                                Register hard bounce
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="gap-2"
                                onSelect={() => {
                                  setActionContactId(row.id);
                                  setConfirmKind("stop");
                                }}
                              >
                                <MessageSquareX className="size-3.5" aria-hidden />
                                Register STOP reply
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="gap-2"
                                onSelect={() => {
                                  setActionContactId(row.id);
                                  setConfirmKind("positive");
                                }}
                              >
                                <MessageSquareCheck className="size-3.5" aria-hidden />
                                Register positive reply
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="events" className="space-y-3">
          <p className="text-sm text-slate-600">
            Last 20 simulator-related audit entries (campaign assignment, bounce, reply).
          </p>
          <ul className="space-y-3">
            {recentEvents.map((ev) => {
              const badge = eventBadge(ev.action, ev.afterState);
              let pretty = "";
              if (ev.afterState) {
                try {
                  pretty = JSON.stringify(JSON.parse(ev.afterState), null, 2);
                } catch {
                  pretty = ev.afterState;
                }
              }
              return (
                <li
                  key={ev.id}
                  className="rounded-lg border bg-card p-4 text-sm shadow-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge className={badge.className}>{badge.label}</Badge>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatRelativeTime(ev.createdAt)}
                    </span>
                  </div>
                  <p className="mt-2 text-slate-800">
                    {ev.resourceId ? (
                      <Link href={`/admin/contacts/${ev.resourceId}`} className="underline underline-offset-4">
                        {ev.resourceLabel}
                      </Link>
                    ) : (
                      ev.resourceLabel
                    )}
                  </p>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-medium text-primary">
                      View details
                    </summary>
                    <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs">
                      {pretty || "—"}
                    </pre>
                  </details>
                </li>
              );
            })}
          </ul>
          {recentEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events yet.</p>
          ) : null}
        </TabsContent>
      </Tabs>

      <Dialog
        open={confirmKind !== null && actionContactId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmKind(null);
            setActionContactId(null);
          }
        }}
      >
        <DialogContent showCloseButton>
          <DialogHeader>
            <DialogTitle>{confirmCopy.title}</DialogTitle>
            <DialogDescription>{confirmCopy.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setConfirmKind(null);
                setActionContactId(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void runConfirmedEvent()}
              disabled={loadingEvent}
            >
              {loadingEvent ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                "Confirm"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
