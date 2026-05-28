import { FileSearch } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/lib/db";
import { getStatusVariant } from "@/lib/badge-helpers";

export const dynamic = "force-dynamic";

function relativeToNow(d: Date): string {
  const diffMs = d.getTime() - Date.now();
  const absDays = Math.round(Math.abs(diffMs) / 86_400_000);
  if (absDays === 0) return "today";
  return diffMs >= 0 ? `in ${absDays}d` : `${absDays}d ago`;
}

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(d);
}

function caseTypeLabel(v: string): string {
  return v.charAt(0).toUpperCase() + v.slice(1);
}

export default async function DsarCasesPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const sp = await searchParams;
  const now = new Date();
  const overdueFilter = sp.filter === "overdue";

  const rows = await db.dsarCase.findMany({
    where: overdueFilter
      ? {
          status: { not: "completed" },
          deadlineAt: { lt: new Date(Date.now() + 7 * 86_400_000) },
        }
      : undefined,
    orderBy: { deadlineAt: "asc" },
  });
  const ownerIds = [...new Set(rows.map((r) => r.ownerId))];
  const owners = ownerIds.length
    ? await db.user.findMany({
        where: { id: { in: ownerIds } },
        select: { id: true, fullName: true },
      })
    : [];
  const ownerById = new Map(owners.map((o) => [o.id, o.fullName]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-600">
            Data Subject Access Requests — GDPR Article 15-22 case management.
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/dsar/new">
            <FileSearch className="mr-2 size-4" />
            New case
          </Link>
        </Button>
      </div>

      <div className="sticky top-0 z-10 -mx-6 mb-4 border-b bg-slate-50 px-6 py-3">
        <div className="flex items-center gap-2 text-sm">
          <Link
            href="/admin/dsar"
            className={`rounded border px-3 py-1 ${!overdueFilter ? "bg-white" : ""}`}
          >
            All cases
          </Link>
          <Link
            href="/admin/dsar?filter=overdue"
            className={`rounded border px-3 py-1 ${overdueFilter ? "bg-white" : ""}`}
          >
            Approaching deadline
          </Link>
        </div>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Case registry</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Case number</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Received</TableHead>
                <TableHead>Deadline</TableHead>
                <TableHead className="text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                    No DSAR cases yet.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => {
                  const subject = r.subjectName || r.subjectEmail || "—";
                  const nearDeadline =
                    r.status !== "completed" &&
                    r.deadlineAt.getTime() - now.getTime() < 7 * 86_400_000;
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <span className="font-medium text-slate-900">
                          <Link href={`/admin/dsar/${r.id}`} className="underline-offset-4 hover:underline">
                            {r.caseNumber}
                          </Link>
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {caseTypeLabel(r.caseType)}
                        </span>
                      </TableCell>
                      <TableCell>{caseTypeLabel(r.caseType)}</TableCell>
                      <TableCell>{subject}</TableCell>
                      <TableCell>{ownerById.get(r.ownerId) ?? r.ownerId}</TableCell>
                      <TableCell>{fmtDate(r.receivedAt)}</TableCell>
                      <TableCell className={nearDeadline ? "font-medium text-rose-700" : ""}>
                        {relativeToNow(r.deadlineAt)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge className={getStatusVariant(r.status)}>{r.status}</Badge>
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
