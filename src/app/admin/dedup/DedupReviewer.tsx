"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DedupCandidate } from "@/services/dedup";
import {
  CONTACT_OVERRIDEABLE_FIELDS,
  COMPANY_OVERRIDEABLE_FIELDS,
} from "@/services/merge";

type FilterType = "all" | "contact" | "company";

type Props = {
  candidates: DedupCandidate[];
  clients: { id: string; name: string }[];
  currentClientId: string;
  currentMinConfidence: number;
  currentType: FilterType;
};

/**
 * Reviewer surface for duplicate candidates.
 *
 * Filters (client / min-confidence slider / type) live in the URL so the
 * server component re-queries the dedup engine on every change and the page
 * is shareable / bookmarkable. Candidate mutations (dismiss, merge) only
 * affect local state — merges trigger a router.refresh() so the dedup engine
 * re-runs and audit/health counters update.
 *
 * Known limitations:
 *   - Dismissals are not persisted. Reloading the page brings them back. A
 *     future step can add a DismissedDup table + filter.
 *   - Field overrides are flat (true = take mergedFrom). Composite values
 *     (e.g. merge phone arrays) need richer UI later.
 */
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
  const [toast, setToast] = useState<string | null>(null);

  function updateFilter(name: string, value: string) {
    const sp = new URLSearchParams();
    sp.set("clientId", name === "clientId" ? value : currentClientId);
    sp.set(
      "minConfidence",
      name === "minConfidence" ? value : String(currentMinConfidence),
    );
    sp.set("type", name === "type" ? value : currentType);
    startTransition(() => {
      router.push(`/admin/dedup?${sp.toString()}`);
    });
  }

  function keyOf(c: DedupCandidate): string {
    return `${c.type}::${c.survivorId}::${c.mergedFromId}`;
  }

  const visible = candidates.filter((c) => !removedKeys.has(keyOf(c)));

  function flashToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 3500);
  }

  return (
    <>
      {/* ---- Filter bar ---- */}
      <div className="sticky top-0 z-10 bg-white border rounded p-4 mb-6 flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">Client</label>
          <select
            value={currentClientId}
            onChange={(e) => updateFilter("clientId", e.target.value)}
            disabled={isPending}
            className="border rounded px-3 py-1 text-sm"
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 grow max-w-md">
          <label className="text-xs text-gray-500">
            Min. confidence:{" "}
            <span className="font-mono">
              {Math.round(currentMinConfidence * 100)}%
            </span>
          </label>
          <input
            type="range"
            min="0.5"
            max="1"
            step="0.05"
            value={currentMinConfidence}
            onChange={(e) => updateFilter("minConfidence", e.target.value)}
            disabled={isPending}
            className="w-full"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">Type</label>
          <select
            value={currentType}
            onChange={(e) => updateFilter("type", e.target.value)}
            disabled={isPending}
            className="border rounded px-3 py-1 text-sm"
          >
            <option value="all">All</option>
            <option value="contact">Contacts</option>
            <option value="company">Companies</option>
          </select>
        </div>

        <div className="ml-auto text-sm text-gray-700">
          <span className="font-medium">{visible.length}</span> candidate
          {visible.length === 1 ? "" : "s"} at confidence ≥{" "}
          <span className="font-mono">
            {Math.round(currentMinConfidence * 100)}%
          </span>
        </div>
      </div>

      {/* ---- Toast ---- */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 bg-green-600 text-white text-sm px-4 py-2 rounded shadow-lg">
          {toast}
        </div>
      )}

      {/* ---- Cards / empty state ---- */}
      {visible.length === 0 ? (
        <div className="border rounded p-8 text-center text-gray-600 text-sm">
          No duplicate candidates at this confidence threshold. Adjust filters
          above.
        </div>
      ) : (
        visible.map((c) => (
          <CandidateCard
            key={keyOf(c)}
            candidate={c}
            onMerged={() => {
              setRemovedKeys((prev) => new Set(prev).add(keyOf(c)));
              flashToast("Merged. View in audit log.");
              // Refresh the server component so the next render reflects the
              // soft-archived mergedFromId everywhere (dedup engine, health
              // counters, etc.).
              router.refresh();
            }}
            onDismissed={() => {
              setRemovedKeys((prev) => new Set(prev).add(keyOf(c)));
            }}
          />
        ))
      )}
    </>
  );
}

// ============================================================
// Candidate card
// ============================================================

function CandidateCard({
  candidate,
  onMerged,
  onDismissed,
}: {
  candidate: DedupCandidate;
  onMerged: () => void;
  onDismissed: () => void;
}) {
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
        onMerged();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const typeBadgeClass =
    candidate.type === "contact"
      ? "bg-blue-100 text-blue-800"
      : "bg-purple-100 text-purple-800";

  return (
    <div className="border rounded p-4 mb-4 bg-white">
      <div className="flex items-center gap-3 mb-3 text-sm">
        <span
          className={`text-xs px-2 py-1 rounded uppercase tracking-wide ${typeBadgeClass}`}
        >
          {candidate.type}
        </span>
        <span className="font-medium tabular-nums">
          {Math.round(candidate.confidence * 100)}% confidence
        </span>
        <span className="italic text-gray-600">{candidate.matchReason}</span>
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-left text-gray-500">
            <th className="py-1 pr-2 font-medium w-32">Field</th>
            <th className="py-1 pr-2 font-medium">Survivor</th>
            <th className="py-1 pr-2 font-medium">Merged from</th>
            <th className="py-1 font-medium w-56">Take from →</th>
          </tr>
        </thead>
        <tbody>
          {candidate.fieldComparison.map((fc) => {
            const canOverride = overrideable.has(fc.field);
            const valuesEqual =
              (fc.survivorValue ?? null) === (fc.mergedFromValue ?? null);
            const disabled = !canOverride || valuesEqual;
            const taking = overrides[fc.field] === true;

            return (
              <tr key={fc.field} className="border-b last:border-b-0">
                <td className="py-2 pr-2 font-mono">{fc.field}</td>
                <td
                  className={`py-2 pr-2 ${
                    !taking && canOverride && !valuesEqual
                      ? "font-medium"
                      : ""
                  }`}
                >
                  {fmt(fc.survivorValue)}
                </td>
                <td
                  className={`py-2 pr-2 ${taking ? "font-medium" : ""}`}
                >
                  {fmt(fc.mergedFromValue)}
                </td>
                <td className="py-2">
                  {disabled ? (
                    <span className="text-gray-400">—</span>
                  ) : (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          setOverrides((p) => ({ ...p, [fc.field]: false }))
                        }
                        className={`text-xs px-2 py-1 rounded border ${
                          !taking
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                        }`}
                      >
                        Keep survivor
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setOverrides((p) => ({ ...p, [fc.field]: true }))
                        }
                        className={`text-xs px-2 py-1 rounded border ${
                          taking
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                        }`}
                      >
                        Use merged-from
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mt-4">
        <input
          type="text"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            if (error) setError(null);
          }}
          placeholder="Why this merge? (logged in merge_history)"
          className="w-full border rounded px-3 py-2 text-sm"
          disabled={submitting}
        />
      </div>

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={onApprove}
          disabled={submitting}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm disabled:opacity-50"
        >
          {submitting ? "Merging…" : "Approve and merge"}
        </button>
        <button
          type="button"
          onClick={onDismissed}
          disabled={submitting}
          className="bg-gray-200 hover:bg-gray-300 text-gray-800 px-4 py-2 rounded text-sm disabled:opacity-50"
        >
          Dismiss
        </button>
        {error && (
          <span className="text-xs text-red-700">Error: {error}</span>
        )}
      </div>
    </div>
  );
}

function fmt(v: string | null): string {
  if (v == null || v === "") return "—";
  return v;
}
