import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/lib/db";
import RollbackAction from "./RollbackAction";

export const dynamic = "force-dynamic";

function relative(d: Date): string {
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

export default async function RollbackPage({
  searchParams,
}: {
  searchParams: Promise<{ batchId?: string }>;
}) {
  const sp = await searchParams;
  const batchIdFilter = (sp.batchId ?? "").trim();
  const snapshots = await db.batchSnapshot.findMany({
    where: {
      expiresAt: { gt: new Date() },
      ...(batchIdFilter ? { batchId: batchIdFilter } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      batchId: true,
      batchType: true,
      createdAt: true,
      expiresAt: true,
      recordId: true,
    },
  });

  const grouped = new Map<
    string,
    { batchType: string; createdAt: Date; expiresAt: Date; recordsAffected: number }
  >();
  for (const s of snapshots) {
    const existing = grouped.get(s.batchId);
    if (!existing) {
      grouped.set(s.batchId, {
        batchType: s.batchType,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        recordsAffected: 1,
      });
      continue;
    }
    existing.recordsAffected += 1;
    if (s.createdAt < existing.createdAt) existing.createdAt = s.createdAt;
    if (s.expiresAt > existing.expiresAt) existing.expiresAt = s.expiresAt;
  }

  const rows = [...grouped.entries()]
    .map(([batchId, row]) => ({ batchId, ...row }))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Rollback</h1>
        <p className="text-sm text-slate-600">Restore recent batch writes from stored snapshots.</p>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Eligible batches</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Batch type</TableHead>
                <TableHead>Batch id</TableHead>
                <TableHead className="text-right">Records affected</TableHead>
                <TableHead>Age</TableHead>
                <TableHead>Eligibility</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No rollback snapshots currently eligible.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const ageMs = Date.now() - row.createdAt.getTime();
                  const expired = row.expiresAt.getTime() <= Date.now();
                  const requiresReview = ageMs > 24 * 60 * 60 * 1000;
                  const status = expired
                    ? "expired"
                    : requiresReview
                      ? "requires-review"
                      : "routine";
                  return (
                    <TableRow key={row.batchId}>
                      <TableCell>{row.batchType}</TableCell>
                      <TableCell className="font-mono text-xs">...{row.batchId.slice(-8)}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.recordsAffected}</TableCell>
                      <TableCell>{relative(row.createdAt)}</TableCell>
                      <TableCell>
                        <Badge variant={status === "routine" ? "default" : "outline"}>{status}</Badge>
                      </TableCell>
                      <TableCell>
                        <RollbackAction batchId={row.batchId} requiresReview={requiresReview} />
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
