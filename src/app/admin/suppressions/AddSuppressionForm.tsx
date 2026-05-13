"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";

export type ClientOption = { id: string; name: string };

type Props = {
  clients: ClientOption[];
};

type Scope = "global" | "client_level" | "domain_level";
type TargetKind = "contact" | "email" | "domain";

const REASON_CODES = [
  "competitor",
  "opt_out",
  "stop_reply",
  "legal_block",
  "conflict_of_interest",
  "bounce_repeated",
] as const;

export default function AddSuppressionForm({ clients }: Props) {
  const router = useRouter();
  const [scope, setScope] = useState<Scope>("global");
  const [clientId, setClientId] = useState<string>(clients[0]?.id ?? "");
  const [targetKind, setTargetKind] = useState<TargetKind>("email");
  const [targetValue, setTargetValue] = useState<string>("");
  const [reasonCode, setReasonCode] = useState<string>("competitor");
  const [reasonDetail, setReasonDetail] = useState<string>("");
  const [isOptOut, setIsOptOut] = useState<boolean>(false);
  const [coolingMode, setCoolingMode] = useState<"indefinite" | "dated">(
    "indefinite",
  );
  const [coolingDate, setCoolingDate] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetAfterSuccess() {
    setTargetValue("");
    setReasonDetail("");
    setIsOptOut(false);
    setCoolingMode("indefinite");
    setCoolingDate("");
    setError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmed = targetValue.trim();
    const isBroadClient = scope === "client_level" && trimmed === "";
    if (!isBroadClient && trimmed === "") {
      setError(
        "Target value is required (or pick client_level + leave empty for a broad-client block).",
      );
      return;
    }
    if (isOptOut && coolingMode === "dated" && !coolingDate) {
      setError("Pick a cooling-period end date or switch to Indefinite.");
      return;
    }

    const body: Record<string, unknown> = {
      scope,
      reasonCode,
      reasonDetail: reasonDetail.trim() || undefined,
      isOptOut,
      coolingPeriodIndefinite: !isOptOut || coolingMode === "indefinite",
    };
    if (scope === "client_level") body.clientId = clientId;
    if (!isBroadClient) {
      if (targetKind === "contact") body.contactId = trimmed;
      else if (targetKind === "email") body.email = trimmed;
      else if (targetKind === "domain") body.domain = trimmed;
    }
    if (isOptOut && coolingMode === "dated") {
      body.reviewRequiredBefore = new Date(coolingDate).toISOString();
    }

    setLoading(true);
    try {
      const res = await fetch("/api/suppressions/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || data.error || `HTTP ${res.status}`);
        return;
      }
      resetAfterSuccess();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const targetLabel =
    targetKind === "contact"
      ? "Contact id"
      : targetKind === "email"
        ? "Email address"
        : "Domain";
  const targetPlaceholder =
    targetKind === "contact"
      ? "cmxxxxxx..."
      : targetKind === "email"
        ? "person@example.com"
        : "example.com";

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row flex-wrap items-baseline justify-between gap-2 space-y-0">
        <CardTitle>Add new suppression</CardTitle>
        <p className="text-xs text-muted-foreground">
          owner = data_owner · source = manual
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-6 text-sm">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sup-scope">Scope</Label>
              <Select
                value={scope}
                onValueChange={(v) => setScope(v as Scope)}
              >
                <SelectTrigger id="sup-scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">global — every client</SelectItem>
                  <SelectItem value="client_level">client_level — one client</SelectItem>
                  <SelectItem value="domain_level">domain_level — by domain</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {scope === "client_level" ? (
              <div className="space-y-2">
                <Label htmlFor="sup-client">Client</Label>
                <Select value={clientId} onValueChange={setClientId}>
                  <SelectTrigger id="sup-client">
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
            ) : null}
          </div>

          <div className="space-y-3">
            <Label>Target</Label>
            <div className="flex flex-wrap gap-4">
              {(["contact", "email", "domain"] as TargetKind[]).map((kind) => (
                <label key={kind} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="target-kind"
                    checked={targetKind === kind}
                    onChange={() => setTargetKind(kind)}
                    className="size-4"
                  />
                  <span className="capitalize">{kind}</span>
                </label>
              ))}
            </div>
            <div className="space-y-2">
              <Label htmlFor="sup-target">{targetLabel}</Label>
              <Input
                id="sup-target"
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
                placeholder={targetPlaceholder}
                className="font-mono text-xs"
              />
              {scope === "client_level" ? (
                <p className="text-xs text-muted-foreground">
                  Leave blank to block ALL contacts for the selected client (broad-client
                  suppression).
                </p>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sup-reason-code">Reason code</Label>
              <Select value={reasonCode} onValueChange={setReasonCode}>
                <SelectTrigger id="sup-reason-code">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REASON_CODES.map((rc) => (
                    <SelectItem key={rc} value={rc}>
                      {rc}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sup-reason-detail">Reason detail (optional)</Label>
              <Textarea
                id="sup-reason-detail"
                value={reasonDetail}
                onChange={(e) => setReasonDetail(e.target.value)}
                placeholder="Free-form notes for auditors"
                rows={2}
              />
            </div>
          </div>

          <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
            <div className="flex items-start gap-3">
              <Checkbox
                id="sup-optout"
                checked={isOptOut}
                onCheckedChange={(v) => setIsOptOut(v === true)}
              />
              <div className="space-y-1">
                <Label htmlFor="sup-optout" className="font-medium leading-none">
                  Is opt-out
                </Label>
                <p className="text-xs text-muted-foreground">
                  Regulatory; bypasses scope rules
                </p>
              </div>
            </div>
            {isOptOut ? (
              <div className="space-y-3 pl-7">
                <Label className="text-xs">Cooling period</Label>
                <div className="flex flex-wrap gap-4">
                  {(["indefinite", "dated"] as const).map((mode) => (
                    <label key={mode} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="cooling-mode"
                        checked={coolingMode === mode}
                        onChange={() => setCoolingMode(mode)}
                        className="size-4"
                      />
                      <span>
                        {mode === "indefinite" ? "Indefinite" : "Until specific date"}
                      </span>
                    </label>
                  ))}
                </div>
                {coolingMode === "dated" ? (
                  <Input
                    type="date"
                    value={coolingDate}
                    onChange={(e) => setCoolingDate(e.target.value)}
                    className="max-w-xs"
                  />
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={loading}>
              {loading ? "Saving…" : "Add suppression"}
            </Button>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
