"use client";

import { Loader2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  CANONICAL_CSV_FIELDS,
  detectHeaderMappings,
  type HeaderMappingOverride,
} from "@/lib/csv-parser";

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

type PrecheckResponse = {
  counts: {
    would_be_accepted: number;
    would_be_rejected_tombstone: number;
    would_be_rejected_duplicate_in_batch: number;
    would_be_rejected_validation: number;
    would_be_rejected_existing_master_duplicate: number;
  };
  totalRows: number;
};

function fileSummary(file: File): string {
  const kb = (file.size / 1024).toFixed(1);
  return `${file.name} (${kb} KB)`;
}

export default function UploadForm({ clients }: UploadFormProps) {
  const router = useRouter();

  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [source, setSource] =
    useState<(typeof SOURCE_OPTIONS)[number]["value"]>("crm_export");
  const [sourceDetail, setSourceDetail] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [detectedHeaders, setDetectedHeaders] = useState<string[]>([]);
  const [headerMappings, setHeaderMappings] = useState<HeaderMappingOverride>({});
  const [mappingConfirmed, setMappingConfirmed] = useState(false);
  const [precheck, setPrecheck] = useState<PrecheckResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [prechecking, setPrechecking] = useState(false);
  const [success, setSuccess] = useState<ApiSuccess | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function onFileSelected(next: File | null) {
    setFile(next);
    setDetectedHeaders([]);
    setHeaderMappings({});
    setMappingConfirmed(false);
    setPrecheck(null);
    setSuccess(null);
    setError(null);
    if (!next) return;
    try {
      const text = await next.text();
      const firstLine = text.split(/\r?\n/)[0] ?? "";
      const headers = firstLine
        .split(",")
        .map((h) => h.trim())
        .filter(Boolean);
      const mapping = detectHeaderMappings(headers);
      setDetectedHeaders(headers);
      setHeaderMappings(mapping);
    } catch (err) {
      setError({
        error: "mapping_preview_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function runPrecheck() {
    setError(null);
    setPrecheck(null);
    if (!clientId) {
      setError({ error: "client_missing", message: "Please choose a client." });
      return;
    }
    if (!file) {
      setError({ error: "file_missing", message: "Please choose a CSV file." });
      return;
    }
    setPrechecking(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("clientId", clientId);
      formData.append("mappings", JSON.stringify(headerMappings));
      const res = await fetch("/api/intake/upload/precheck", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data as ApiError);
        return;
      }
      setPrecheck(data as PrecheckResponse);
      setMappingConfirmed(true);
    } catch (err) {
      setError({
        error: "precheck_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setPrechecking(false);
    }
  }

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
      formData.append("mappings", JSON.stringify(headerMappings));
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
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle>Import details</CardTitle>
      </CardHeader>
      <CardContent>
        {clients.length === 0 ? (
          <Alert>
            <AlertTitle>No clients</AlertTitle>
            <AlertDescription>
              Seed the database before uploading a CSV.
            </AlertDescription>
          </Alert>
        ) : null}
        <form onSubmit={onSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="clientId">Client</Label>
            <Select
              value={clientId}
              onValueChange={(v) => {
                setClientId(v);
                setMappingConfirmed(false);
                setPrecheck(null);
              }}
              disabled={submitting || clients.length === 0}
            >
              <SelectTrigger id="clientId" className="w-full">
                <SelectValue placeholder="Select client" />
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
            <Label htmlFor="source">Source</Label>
            <Select
              value={source}
              onValueChange={(v) => {
                setSource(v as (typeof SOURCE_OPTIONS)[number]["value"]);
                setMappingConfirmed(false);
                setPrecheck(null);
              }}
              disabled={submitting}
            >
              <SelectTrigger id="source" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sourceDetail">
              Source detail{" "}
              <span className="font-normal text-slate-400">(optional)</span>
            </Label>
            <Input
              id="sourceDetail"
              type="text"
              placeholder="e.g. Salesforce Q1 export"
              value={sourceDetail}
              onChange={(e) => setSourceDetail(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="file">CSV file</Label>
            <Input
              id="file"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const target = e.target as HTMLInputElement;
                void onFileSelected(target.files?.[0] ?? null);
              }}
              disabled={submitting}
              className="cursor-pointer"
            />
            {file ? (
              <p className="text-sm text-slate-600">
                Selected: {fileSummary(file)}
              </p>
            ) : null}
            <a
              href="/samples/test_import.csv"
              download
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              Download sample CSV (demonstrates all intake outcomes)
            </a>
          </div>

          {detectedHeaders.length > 0 ? (
            <Card className="border-dashed">
              <CardHeader>
                <CardTitle className="text-base">Field mapping preview</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {detectedHeaders.map((header) => (
                  <div key={header} className="grid items-center gap-2 md:grid-cols-2">
                    <p className="font-mono text-xs text-slate-700">{header}</p>
                    <Select
                      value={headerMappings[header] ?? "__ignore"}
                      onValueChange={(v) => {
                        setHeaderMappings((prev) => ({
                          ...prev,
                          [header]: v as HeaderMappingOverride[string],
                        }));
                        setMappingConfirmed(false);
                        setPrecheck(null);
                      }}
                      disabled={submitting || prechecking}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__ignore">Ignore column</SelectItem>
                        {CANONICAL_CSV_FIELDS.map((field) => (
                          <SelectItem key={field} value={field}>
                            {field}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {!mappingConfirmed ? (
            <Button
              type="button"
              disabled={prechecking || submitting || clients.length === 0 || !file}
              className="gap-2"
              onClick={runPrecheck}
            >
              {prechecking ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {prechecking ? "Running pre-check…" : "Confirm mapping and run pre-check"}
            </Button>
          ) : null}

          {precheck ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Pre-check report</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p>Total rows: {precheck.totalRows}</p>
                <p>would_be_accepted: {precheck.counts.would_be_accepted}</p>
                <p>would_be_rejected_tombstone: {precheck.counts.would_be_rejected_tombstone}</p>
                <p>would_be_rejected_duplicate_in_batch: {precheck.counts.would_be_rejected_duplicate_in_batch}</p>
                <p>would_be_rejected_validation: {precheck.counts.would_be_rejected_validation}</p>
                <p>
                  would_be_rejected_existing_master_duplicate:{" "}
                  {precheck.counts.would_be_rejected_existing_master_duplicate}
                </p>
              </CardContent>
            </Card>
          ) : null}

          <Button
            type="submit"
            disabled={
              submitting ||
              clients.length === 0 ||
              !mappingConfirmed ||
              precheck == null
            }
            className="gap-2"
          >
            {submitting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Upload className="size-4" aria-hidden />
            )}
            {submitting ? "Uploading…" : "Proceed with import"}
          </Button>

          {error && (
            <Alert variant="destructive">
              <AlertTitle>Upload failed: {error.error}</AlertTitle>
              <AlertDescription className="space-y-2">
                {error.message ? <p>{error.message}</p> : null}
                {error.details && error.details.length > 0 ? (
                  <ul className="list-inside list-disc text-sm">
                    {error.details.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                ) : null}
              </AlertDescription>
            </Alert>
          )}

          {success && (
            <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900">
              <AlertTitle>Intake complete</AlertTitle>
              <AlertDescription className="space-y-3 text-emerald-900/90">
                <p>
                  Batch{" "}
                  <code className="rounded bg-emerald-100/80 px-1 font-mono text-sm">
                    {success.batchId}
                  </code>
                </p>
                <p className="text-sm">
                  <span className="font-semibold">{success.rowsAccepted}</span>{" "}
                  accepted,{" "}
                  <span className="font-semibold">{success.rowsRejected}</span>{" "}
                  rejected,{" "}
                  <span className="font-semibold">{success.rowsTotal}</span> total
                </p>
                {nonZeroRejections.length > 0 ? (
                  <div className="text-sm">
                    <p className="font-medium">Rejection breakdown</p>
                    <ul className="mt-1 list-inside list-disc">
                      {nonZeroRejections.map(([reason, count]) => (
                        <li key={reason}>
                          {reason}: {count}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => router.push(success.redirectUrl)}
                >
                  View batch detail
                </Button>
              </AlertDescription>
            </Alert>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
