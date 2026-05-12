"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type ConflictCardProps = {
  enrichmentLogId: string;
  field: string;
  cognism: { value: string | null; confidence: number };
  apollo: { value: string | null; confidence: number };
  delta: number;
};

/**
 * Inline resolution card for a single conflict_pending enrichment_log row.
 * Pure UI — all server-side work happens through /api/conflicts/resolve.
 *
 * On a successful POST the parent server component is refreshed; the row's
 * status flips to "conflict_resolved" and the card naturally drops out of the
 * "Pending conflicts" list on the next render.
 */
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
    <div className="rounded border border-amber-300 bg-amber-50 p-4 mb-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-medium text-amber-900">
          Conflict on field: <code className="font-mono">{field}</code>
        </h3>
        <span className="text-xs text-amber-700">
          Δ confidence = {(delta * 100).toFixed(1)}%
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
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
              className={`flex cursor-pointer items-start gap-3 rounded border p-3 text-sm ${
                isSelected
                  ? "border-blue-500 bg-white shadow-sm"
                  : "border-gray-200 bg-white hover:border-gray-300"
              }`}
            >
              <input
                type="radio"
                name={`conflict-${enrichmentLogId}`}
                checked={isSelected}
                onChange={() => setChosen(key)}
                className="mt-1"
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs uppercase tracking-wide text-gray-500">
                  {label}
                </div>
                <div className="mt-1 break-words font-medium text-gray-900">
                  {fmt(side.value)}
                </div>
                <div className="text-xs text-gray-600">
                  confidence {(side.confidence * 100).toFixed(0)}%
                </div>
              </div>
            </label>
          );
        })}
      </div>

      <div className="mt-3">
        <label className="text-xs text-amber-900">
          Resolution reason (logged in audit_log)
        </label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Apollo is more accurate for IT in this segment"
          className="mt-1 w-full rounded border px-3 py-2 text-sm"
          disabled={loading}
        />
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={onResolve}
          disabled={loading}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Resolving…" : "Resolve"}
        </button>
        {error && <p className="text-sm text-red-700">{error}</p>}
      </div>
    </div>
  );
}
