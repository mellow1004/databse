"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Client = { id: string; name: string };

type UploadFormProps = { clients: Client[] };

const SOURCE_OPTIONS = [
  { value: "crm_export", label: "CRM export" },
  { value: "campaign_file", label: "Campaign file" },
  { value: "spreadsheet", label: "Spreadsheet" },
  { value: "vendor_export", label: "Vendor export" },
  { value: "manual", label: "Manual" },
] as const;

type ApiSuccess = {
  batchId: string;
  rowsTotal: number;
  rowsAccepted: number;
  rowsRejected: number;
  rejectionBreakdown: Record<string, number>;
  redirectUrl: string;
};

type ApiError = {
  error: string;
  message?: string;
  details?: string[];
};

export default function UploadForm({ clients }: UploadFormProps) {
  const router = useRouter();

  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [source, setSource] = useState<(typeof SOURCE_OPTIONS)[number]["value"]>("crm_export");
  const [sourceDetail, setSourceDetail] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<ApiSuccess | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!clientId) {
      setError({ error: "client_missing", message: "Please choose a client." });
      return;
    }
    if (!file) {
      setError({ error: "file_missing", message: "Please choose a CSV file." });
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("clientId", clientId);
    formData.append("source", source);
    if (sourceDetail.trim()) {
      formData.append("sourceDetail", sourceDetail.trim());
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/intake/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data as ApiError);
      } else {
        setSuccess(data as ApiSuccess);
      }
    } catch (err) {
      setError({
        error: "network_error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  }

  const nonZeroRejections = success
    ? Object.entries(success.rejectionBreakdown).filter(([, count]) => count > 0)
    : [];

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="clientId" className="block text-sm font-medium mb-1">
          Client
        </label>
        <select
          id="clientId"
          className="w-full border rounded px-3 py-2 bg-white"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          disabled={submitting}
        >
          {clients.length === 0 ? (
            <option value="">— no clients seeded —</option>
          ) : (
            clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))
          )}
        </select>
      </div>

      <div>
        <label htmlFor="source" className="block text-sm font-medium mb-1">
          Source
        </label>
        <select
          id="source"
          className="w-full border rounded px-3 py-2 bg-white"
          value={source}
          onChange={(e) =>
            setSource(e.target.value as (typeof SOURCE_OPTIONS)[number]["value"])
          }
          disabled={submitting}
        >
          {SOURCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="sourceDetail" className="block text-sm font-medium mb-1">
          Source detail{" "}
          <span className="font-normal text-gray-400">(optional)</span>
        </label>
        <input
          id="sourceDetail"
          type="text"
          className="w-full border rounded px-3 py-2"
          placeholder="e.g. Salesforce Q1 export"
          value={sourceDetail}
          onChange={(e) => setSourceDetail(e.target.value)}
          disabled={submitting}
        />
      </div>

      <div>
        <label htmlFor="file" className="block text-sm font-medium mb-1">
          CSV file
        </label>
        <input
          id="file"
          type="file"
          accept=".csv,text/csv"
          className="w-full border rounded px-3 py-2 bg-white"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={submitting}
        />
        {file && (
          <p className="mt-1 text-xs text-gray-500">
            {file.name} · {file.size.toLocaleString()} bytes
          </p>
        )}
        <a
          href="/samples/test_import.csv"
          download
          className="text-sm text-blue-600 underline mt-1 inline-block"
        >
          Download sample CSV (demonstrates all intake outcomes)
        </a>
      </div>

      <div>
        <button
          type="submit"
          disabled={submitting}
          className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
        >
          {submitting ? "Uploading…" : "Upload and stage"}
        </button>
      </div>

      {error && (
        <div className="mt-4 border border-red-300 bg-red-50 text-red-800 rounded p-4">
          <p className="font-medium">Upload failed: {error.error}</p>
          {error.message && <p className="mt-1 text-sm">{error.message}</p>}
          {error.details && error.details.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-sm">
              {error.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {success && (
        <div className="mt-4 border border-green-300 bg-green-50 text-green-900 rounded p-4">
          <p className="font-medium">Intake complete</p>
          <p className="mt-1 text-sm">
            Batch <code className="font-mono">{success.batchId}</code>
          </p>
          <p className="mt-2 text-sm">
            <span className="font-medium">{success.rowsAccepted}</span> accepted,{" "}
            <span className="font-medium">{success.rowsRejected}</span> rejected,{" "}
            <span className="font-medium">{success.rowsTotal}</span> total
          </p>

          {nonZeroRejections.length > 0 && (
            <div className="mt-2 text-sm">
              <div className="font-medium">Rejection breakdown</div>
              <ul className="mt-1 list-disc pl-5">
                {nonZeroRejections.map(([reason, count]) => (
                  <li key={reason}>
                    {reason}: {count}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            type="button"
            onClick={() => router.push(success.redirectUrl)}
            className="mt-4 bg-blue-600 text-white px-4 py-2 rounded"
          >
            View batch detail
          </button>
        </div>
      )}
    </form>
  );
}
