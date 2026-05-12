"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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

/**
 * Inline "Add suppression" form. The target-field radio collapses three
 * model columns (contactId/email/domain) into a single user-facing input
 * whose label flips based on the selected kind.
 *
 * For `client_level` scope the user can leave the target value empty to
 * register a "broad-client" suppression — supported by the service and
 * called out below the input.
 */
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
      setError("Target value is required (or pick client_level + leave empty for a broad-client block).");
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
    <form
      onSubmit={onSubmit}
      className="border rounded p-4 bg-white shadow-sm space-y-4 text-sm"
    >
      <div className="flex items-baseline justify-between">
        <h2 className="font-medium">Add suppression</h2>
        <span className="text-xs text-gray-500">
          owner = data_owner · source = manual
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-gray-600">Scope</span>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as Scope)}
            className="mt-1 w-full rounded border px-3 py-2"
          >
            <option value="global">global — applies to every client</option>
            <option value="client_level">client_level — one client only</option>
            <option value="domain_level">domain_level — by domain only</option>
          </select>
        </label>

        {scope === "client_level" && (
          <label className="block">
            <span className="text-xs text-gray-600">Client</span>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="mt-1 w-full rounded border px-3 py-2"
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div>
        <span className="text-xs text-gray-600">Target</span>
        <div className="mt-1 flex flex-wrap gap-3 text-sm">
          {(["contact", "email", "domain"] as TargetKind[]).map((kind) => (
            <label key={kind} className="inline-flex items-center gap-1">
              <input
                type="radio"
                name="target-kind"
                checked={targetKind === kind}
                onChange={() => setTargetKind(kind)}
              />
              <span>{kind}</span>
            </label>
          ))}
        </div>
        <label className="block mt-2">
          <span className="text-xs text-gray-600">{targetLabel}</span>
          <input
            type="text"
            value={targetValue}
            onChange={(e) => setTargetValue(e.target.value)}
            placeholder={targetPlaceholder}
            className="mt-1 w-full rounded border px-3 py-2 font-mono text-xs"
          />
          {scope === "client_level" && (
            <span className="text-xs text-gray-500 mt-1 block">
              Leave blank to block ALL contacts for the selected client
              (broad-client suppression).
            </span>
          )}
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-gray-600">Reason code</span>
          <select
            value={reasonCode}
            onChange={(e) => setReasonCode(e.target.value)}
            className="mt-1 w-full rounded border px-3 py-2"
          >
            {REASON_CODES.map((rc) => (
              <option key={rc} value={rc}>
                {rc}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-gray-600">Reason detail (optional)</span>
          <textarea
            value={reasonDetail}
            onChange={(e) => setReasonDetail(e.target.value)}
            placeholder="Free-form notes for auditors"
            rows={2}
            className="mt-1 w-full rounded border px-3 py-2"
          />
        </label>
      </div>

      <div className="rounded border border-gray-200 bg-gray-50 p-3">
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isOptOut}
            onChange={(e) => setIsOptOut(e.target.checked)}
          />
          <span>
            <span className="font-medium">Is opt-out</span>
            <span className="ml-2 text-xs text-gray-500">
              regulatory; bypasses scope rules
            </span>
          </span>
        </label>

        {isOptOut && (
          <div className="mt-3 space-y-2">
            <span className="block text-xs text-gray-600">Cooling period</span>
            <div className="flex flex-wrap gap-3 text-sm">
              {(["indefinite", "dated"] as const).map((mode) => (
                <label key={mode} className="inline-flex items-center gap-1">
                  <input
                    type="radio"
                    name="cooling-mode"
                    checked={coolingMode === mode}
                    onChange={() => setCoolingMode(mode)}
                  />
                  <span>{mode === "indefinite" ? "Indefinite" : "Until specific date"}</span>
                </label>
              ))}
            </div>
            {coolingMode === "dated" && (
              <input
                type="date"
                value={coolingDate}
                onChange={(e) => setCoolingDate(e.target.value)}
                className="rounded border px-3 py-2 text-sm"
              />
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm disabled:opacity-50"
        >
          {loading ? "Saving…" : "Add suppression"}
        </button>
        {error && <p className="text-sm text-red-700">{error}</p>}
      </div>
    </form>
  );
}
