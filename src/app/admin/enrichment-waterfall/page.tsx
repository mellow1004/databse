import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/lib/db";
import { apollo, cognism } from "@/providers";

export const dynamic = "force-dynamic";

const PROVIDER_COST_EUR: Record<string, number> = {
  cognism: 0.3,
  apollo: 0.25,
};

const PROVIDER_BASELINE: Record<string, number> = {
  cognism: 0.91,
  apollo: 0.93,
};

function relativeTime(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

function parseFields(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === "string");
  } catch {
    // ignore
  }
  return [];
}

export default async function EnrichmentWaterfallPage() {
  const contracts = await db.integrationContract.findMany({
    where: { providerName: { in: ["cognism", "apollo"] }, status: "active" },
    orderBy: { updatedAt: "desc" },
  });
  const byProvider = new Map(contracts.map((c) => [c.providerName, c]));

  const recentLogs = await db.enrichmentLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true,
      batchId: true,
      contactId: true,
      provider: true,
      status: true,
      confidence: true,
      creditsUsed: true,
      createdAt: true,
      fieldsFilled: true,
      rawResponse: true,
    },
  });

  const grouped = new Map<string, typeof recentLogs>();
  for (const row of recentLogs) {
    const list = grouped.get(row.batchId) ?? [];
    list.push(row);
    grouped.set(row.batchId, list);
  }
  const batches = [...grouped.entries()]
    .sort((a, b) => b[1][0]!.createdAt.getTime() - a[1][0]!.createdAt.getTime())
    .slice(0, 20);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Enrichment waterfall</h1>
        <p className="text-sm text-slate-600">Provider order, recent runs, and field-level provenance.</p>
      </div>

      <Card className="shadow-sm">
        <CardHeader><CardTitle>Configured waterfall</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Primary markets</TableHead>
                <TableHead>Confidence baseline</TableHead>
                <TableHead>Credit cost per call</TableHead>
                <TableHead>Per-record credit cap</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { provider: "cognism", markets: cognism.primaryMarkets },
                { provider: "apollo", markets: apollo.primaryMarkets },
              ].map((row) => {
                const contract = byProvider.get(row.provider);
                const baseline = PROVIDER_BASELINE[row.provider] ?? 0;
                return (
                  <TableRow key={row.provider}>
                    <TableCell className="font-medium">{row.provider}</TableCell>
                    <TableCell>{row.markets.join(", ")}</TableCell>
                    <TableCell>
                      {Math.round(baseline * 100)}%
                      {contract ? " (contracted)" : ""}
                    </TableCell>
                    <TableCell>€{(PROVIDER_COST_EUR[row.provider] ?? 0).toFixed(2)}</TableCell>
                    <TableCell>€10.00</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader><CardTitle>Recent waterfall runs</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Batch</TableHead>
                <TableHead>Contact count</TableHead>
                <TableHead>Provider sequence</TableHead>
                <TableHead>Conflicts flagged</TableHead>
                <TableHead>Average confidence</TableHead>
                <TableHead>Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No enrichment batches yet.</TableCell></TableRow>
              ) : batches.map(([batchId, rows]) => {
                const contacts = new Set(rows.map((r) => r.contactId).filter(Boolean)).size;
                const sequence = [...new Set(rows.map((r) => r.provider))].join(" -> ");
                const conflicts = rows.filter((r) => r.status === "conflict_pending").length;
                const confidentRows = rows.filter((r) => r.confidence !== null);
                const avgConfidence =
                  confidentRows.length === 0
                    ? null
                    : confidentRows.reduce((acc, r) => acc + (r.confidence ?? 0), 0) /
                      confidentRows.length;
                const cost = rows.reduce(
                  (acc, r) => acc + (PROVIDER_COST_EUR[r.provider] ?? 0) * r.creditsUsed,
                  0,
                );

                const firstFiveContacts = [...new Set(rows.map((r) => r.contactId).filter(Boolean))]
                  .slice(0, 5);
                const contactRows = rows.filter((r) => firstFiveContacts.includes(r.contactId ?? ""));

                return (
                  <TableRow key={batchId}>
                    <TableCell>{relativeTime(rows[0]!.createdAt)}</TableCell>
                    <TableCell className="font-mono text-xs">
                      <details>
                        <summary className="cursor-pointer">...{batchId.slice(-8)}</summary>
                        <div className="mt-2 rounded-md border p-2 text-foreground">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Contact</TableHead>
                                <TableHead>Provider</TableHead>
                                <TableHead>Fields</TableHead>
                                <TableHead>Confidence</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {contactRows.map((r) => (
                                <TableRow key={r.id}>
                                  <TableCell className="font-mono text-xs">...{(r.contactId ?? "").slice(-8)}</TableCell>
                                  <TableCell>{r.provider}</TableCell>
                                  <TableCell>{parseFields(r.fieldsFilled).join(", ") || "—"}</TableCell>
                                  <TableCell>{r.confidence == null ? "—" : `${Math.round(r.confidence * 100)}%`}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </details>
                    </TableCell>
                    <TableCell className="tabular-nums">{contacts}</TableCell>
                    <TableCell>{sequence || "—"}</TableCell>
                    <TableCell className="tabular-nums">{conflicts}</TableCell>
                    <TableCell>{avgConfidence == null ? "—" : `${Math.round(avgConfidence * 100)}%`}</TableCell>
                    <TableCell>€{cost.toFixed(2)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader><CardTitle>Field-level provenance example</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Field</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Freshness</TableHead>
                <TableHead>Precedence rule</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(() => {
                const latestByField = new Map<string, (typeof recentLogs)[number]>();
                for (const row of recentLogs) {
                  if (!row.contactId) continue;
                  const fields = parseFields(row.fieldsFilled);
                  for (const field of fields) {
                    if (!latestByField.has(field)) {
                      latestByField.set(field, row);
                    }
                  }
                  if (latestByField.size >= 8) break;
                }
                const rows = [...latestByField.entries()];
                if (rows.length === 0) {
                  return (
                    <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No enrichment provenance available yet.</TableCell></TableRow>
                  );
                }
                return rows.map(([field, row]) => {
                  const marketHint = row.provider === "cognism" ? "SE" : "US";
                  const precedence =
                    row.status === "conflict_pending"
                      ? "Conflict-pending: confidence delta < 15%"
                      : `Primary-by-market: ${row.provider === "cognism" ? "Cognism" : "Apollo"} for ${marketHint}`;
                  return (
                    <TableRow key={field}>
                      <TableCell className="font-mono text-xs">{field}</TableCell>
                      <TableCell>{row.provider}</TableCell>
                      <TableCell>{row.confidence == null ? "—" : `${Math.round(row.confidence * 100)}%`}</TableCell>
                      <TableCell>{relativeTime(row.createdAt)}</TableCell>
                      <TableCell>{precedence}</TableCell>
                    </TableRow>
                  );
                });
              })()}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
