"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

const listTypeOptions = [
  { value: "client_dnc", label: "Client DNC list" },
  { value: "opt_out_register", label: "Opt-out register" },
  { value: "competitor_list", label: "Competitor list" },
  { value: "domain_blocklist", label: "Domain block list" },
  { value: "provider_signal", label: "Provider signal" },
];

export default function SuppressionBulkImportPage() {
  const [listType, setListType] = useState("client_dnc");
  const [clientId, setClientId] = useState("");
  const [csvText, setCsvText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onUploadFile(file: File) {
    const text = await file.text();
    setCsvText(text);
  }

  async function submit() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/suppressions/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listType,
          clientId: clientId.trim() || undefined,
          csvText,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Import failed");
        return;
      }
      if (data.status === "request_pending") {
        setResult(`Bulk approval required: ${data.pendingApprovalId}`);
        return;
      }
      setResult(
        `Imported ${data.rowsImported}/${data.rowsTotal} (rejected ${data.rowsRejected}) in batch ${data.batchId}.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Bulk suppression import</h1>
        <p className="text-sm text-slate-600">
          Upload suppression CSV rows into the governance layer.
        </p>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Import file</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>List type</Label>
            <Select value={listType} onValueChange={setListType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {listTypeOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="client-id">Client id (optional)</Label>
            <Input
              id="client-id"
              placeholder="cm..."
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="csv-file">CSV file</Label>
            <Input
              id="csv-file"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onUploadFile(f);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="csv-text">CSV preview/edit</Label>
            <Textarea
              id="csv-text"
              rows={14}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder="target_type,target_value,scope,reason_code,is_opt_out,notes"
              className="font-mono text-xs"
            />
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={submit} disabled={loading || !csvText.trim()}>
              {loading ? "Importing..." : "Run bulk import"}
            </Button>
            <Link href="/samples/sample_dnc.csv" className="text-sm underline underline-offset-4">
              Download sample CSV
            </Link>
          </div>
          {result ? <p className="text-sm text-emerald-700">{result}</p> : null}
          {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
