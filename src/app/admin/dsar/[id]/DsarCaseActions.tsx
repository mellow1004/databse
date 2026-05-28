"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  caseId: string;
  caseType: string;
  canClose: boolean;
  propagation: {
    tombstoneCreated: boolean;
    aiTrainingDatasetNotified: boolean;
    aiSdrPlatformNotified: boolean;
    subProcessorsNotified: boolean;
  };
};

export default function DsarCaseActions({ caseId, caseType, canClose, propagation }: Props) {
  const router = useRouter();
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closureReason, setClosureReason] = useState("");

  async function postJson(path: string, body?: object) {
    setError(null);
    setLoadingKey(path);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const maybeJson = await res.text();
      const data = maybeJson ? JSON.parse(maybeJson) : {};
      if (!res.ok) {
        setError(data.message || data.error || `HTTP ${res.status}`);
        return null;
      }
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setLoadingKey(null);
    }
  }

  async function runSearch() {
    const out = await postJson(`/api/dsar/cases/${caseId}/search`);
    if (out) router.refresh();
  }

  async function runErasure() {
    const ok = window.confirm("Execute hard-delete erasure for all matched contacts?");
    if (!ok) return;
    const out = await postJson(`/api/dsar/cases/${caseId}/erase`);
    if (out) router.refresh();
  }

  async function confirmTarget(target: "ai_training_dataset" | "ai_sdr_platform" | "sub_processors") {
    const out = await postJson(`/api/dsar/cases/${caseId}/propagation/confirm`, { target });
    if (out) router.refresh();
  }

  async function closeCase() {
    if (!closureReason.trim()) {
      setError("Closure reason is required.");
      return;
    }
    const out = await postJson(`/api/dsar/cases/${caseId}/close`, { closureReason: closureReason.trim() });
    if (out) router.refresh();
  }

  async function exportJson() {
    setError(null);
    setLoadingKey("export");
    try {
      const res = await fetch(`/api/dsar/cases/${caseId}/export`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        setError(data.message || data.error || `HTTP ${res.status}`);
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="(.+)"/);
      const fileName = match?.[1] ?? `dsar-${caseId}.json`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingKey(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={runSearch} disabled={loadingKey !== null}>
          {loadingKey === `/api/dsar/cases/${caseId}/search` ? "Searching…" : "Run subject search"}
        </Button>
        {caseType === "access" ? (
          <Button variant="outline" onClick={exportJson} disabled={loadingKey !== null}>
            {loadingKey === "export" ? "Exporting…" : "Export subject data (JSON)"}
          </Button>
        ) : null}
        {caseType === "erasure" ? (
          <Button
            variant="destructive"
            onClick={runErasure}
            disabled={loadingKey !== null}
          >
            {loadingKey === `/api/dsar/cases/${caseId}/erase` ? "Executing…" : "Execute erasure on all matched records"}
          </Button>
        ) : null}
      </div>

      {caseType === "erasure" ? (
        <div className="space-y-2 rounded-lg border p-4">
          {!propagation.aiTrainingDatasetNotified ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => confirmTarget("ai_training_dataset")}
              disabled={loadingKey !== null}
              className="mr-2"
            >
              Confirm propagation: AI training dataset
            </Button>
          ) : null}
          {!propagation.aiSdrPlatformNotified ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => confirmTarget("ai_sdr_platform")}
              disabled={loadingKey !== null}
              className="mr-2"
            >
              Confirm propagation: AI SDR platform
            </Button>
          ) : null}
          {!propagation.subProcessorsNotified ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => confirmTarget("sub_processors")}
              disabled={loadingKey !== null}
            >
              Confirm propagation: Sub-processors
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-2">
        <Textarea
          value={closureReason}
          onChange={(e) => setClosureReason(e.target.value)}
          placeholder="Closure reason"
          rows={3}
        />
        <Button onClick={closeCase} disabled={!canClose || loadingKey !== null}>
          {loadingKey === `/api/dsar/cases/${caseId}/close` ? "Closing…" : "Close case"}
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
