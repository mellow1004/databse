"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const CASE_TYPES = [
  "access",
  "erasure",
  "rectification",
  "objection",
  "restriction",
  "portability",
] as const;

type ClientOption = { id: string; name: string };
type OwnerOption = { id: string; fullName: string };

export default function NewDsarForm({
  clients,
  owners,
}: {
  clients: ClientOption[];
  owners: OwnerOption[];
}) {
  const router = useRouter();
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [ownerId, setOwnerId] = useState(owners[0]?.id ?? "");
  const [caseType, setCaseType] = useState<(typeof CASE_TYPES)[number]>("erasure");
  const [subjectEmail, setSubjectEmail] = useState("");
  const [subjectPhone, setSubjectPhone] = useState("");
  const [subjectLinkedinUrl, setSubjectLinkedinUrl] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const hasIdentifier =
      subjectEmail.trim() || subjectPhone.trim() || subjectLinkedinUrl.trim() || subjectName.trim();
    if (!hasIdentifier) {
      setError("At least one subject identifier is required.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/dsar/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          ownerId,
          caseType,
          subjectEmail: subjectEmail.trim() || undefined,
          subjectPhone: subjectPhone.trim() || undefined,
          subjectLinkedinUrl: subjectLinkedinUrl.trim() || undefined,
          subjectName: subjectName.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || data.error || `HTTP ${res.status}`);
        return;
      }
      router.push(`/admin/dsar/${data.caseId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="max-w-3xl shadow-sm">
      <CardHeader>
        <CardTitle>Open new DSAR case</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Client</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger>
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
              <Label>Case type</Label>
              <Select value={caseType} onValueChange={(v) => setCaseType(v as (typeof CASE_TYPES)[number])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CASE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Owner</Label>
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {owners.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Subject identifiers</Label>
            <div className="grid gap-3 md:grid-cols-2">
              <Input placeholder="Email" value={subjectEmail} onChange={(e) => setSubjectEmail(e.target.value)} />
              <Input placeholder="Phone" value={subjectPhone} onChange={(e) => setSubjectPhone(e.target.value)} />
              <Input
                placeholder="LinkedIn URL"
                value={subjectLinkedinUrl}
                onChange={(e) => setSubjectLinkedinUrl(e.target.value)}
              />
              <Input placeholder="Full name" value={subjectName} onChange={(e) => setSubjectName(e.target.value)} />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={loading}>
              {loading ? "Opening…" : "Open case"}
            </Button>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
