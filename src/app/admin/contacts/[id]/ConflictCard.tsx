"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type ConflictCardProps = {
  enrichmentLogId: string;
  field: string;
  cognism: { value: string | null; confidence: number };
  apollo: { value: string | null; confidence: number };
  delta: number;
};

export default function ConflictCard({
  enrichmentLogId,
  field,
  cognism,
  apollo,
  delta,
}: ConflictCardProps) {
  const router = useRouter();
  const [chosen, setChosen] = useState<"cognism" | "apollo">("cognism");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onResolve() {
    if (!reason.trim()) {
      setError("Please add a resolution reason — it is logged with the merge.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/conflicts/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enrichmentLogId,
          chosenProvider: chosen,
          reason: reason.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || data.error || `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function fmt(value: string | null): string {
    if (value === null) return "(none)";
    if (value === "") return "(empty)";
    return value;
  }

  return (
    <Card className="border-amber-200 bg-amber-50/50 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base text-amber-950">
          Pending conflict · <code className="font-mono text-sm">{field}</code>
        </CardTitle>
        <p className="text-xs text-amber-800">
          Δ confidence = {(delta * 100).toFixed(1)}%
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {(
            [
              ["cognism", "Cognism's value", cognism] as const,
              ["apollo", "Apollo's value", apollo] as const,
            ]
          ).map(([key, label, side]) => {
            const isSelected = chosen === key;
            return (
              <label
                key={key}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border bg-card p-3 text-sm shadow-sm",
                  isSelected
                    ? "border-primary ring-2 ring-primary/20"
                    : "border-border hover:border-muted-foreground/30",
                )}
              >
                <input
                  type="radio"
                  name={`conflict-${enrichmentLogId}`}
                  checked={isSelected}
                  onChange={() => setChosen(key)}
                  className="mt-1"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {label}
                  </div>
                  <div className="mt-1 break-words font-medium">{fmt(side.value)}</div>
                  <div className="text-xs text-muted-foreground">
                    confidence {(side.confidence * 100).toFixed(0)}%
                  </div>
                </div>
              </label>
            );
          })}
        </div>
        <div className="space-y-2">
          <Label htmlFor={`reason-${enrichmentLogId}`}>
            Resolution reason (logged in audit_log)
          </Label>
          <Input
            id={`reason-${enrichmentLogId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Apollo is more accurate for IT in this segment"
            disabled={loading}
          />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
      <CardFooter>
        <Button type="button" onClick={onResolve} disabled={loading}>
          {loading ? "Resolving…" : "Resolve"}
        </Button>
      </CardFooter>
    </Card>
  );
}
