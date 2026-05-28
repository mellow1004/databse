import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/lib/db";
import { getStatusVariant } from "@/lib/badge-helpers";
import BulkApprovalActions from "./BulkApprovalActions";

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

export default async function BulkApprovalsPage() {
  const rows = await db.bulkActionApproval.findMany({
    orderBy: { requestedAt: "desc" },
    take: 200,
  });
  const userIds = [...new Set(rows.flatMap((r) => [r.requestedBy, r.approvedBy, r.rejectedBy]).filter((v): v is string => Boolean(v)))];
  const users = userIds.length
    ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } })
    : [];
  const userById = new Map(users.map((u) => [u.id, u.fullName]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Bulk approvals</h1>
      </div>
      <Card className="shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action type</TableHead>
                <TableHead className="text-right">Records affected</TableHead>
                <TableHead>Requested by</TableHead>
                <TableHead>Requested at</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.actionType}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.recordsAffected}</TableCell>
                  <TableCell>{userById.get(r.requestedBy) ?? r.requestedBy}</TableCell>
                  <TableCell>{relative(r.requestedAt)}</TableCell>
                  <TableCell>
                    <Badge className={getStatusVariant(r.status)}>{r.status}</Badge>
                  </TableCell>
                  <TableCell>
                    {r.status === "pending" ? (
                      <BulkApprovalActions approvalId={r.id} />
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {r.status === "approved"
                          ? `Approved by ${r.approvedBy ? (userById.get(r.approvedBy) ?? r.approvedBy) : "—"}`
                          : r.status === "rejected"
                            ? `Rejected by ${r.rejectedBy ? (userById.get(r.rejectedBy) ?? r.rejectedBy) : "—"}`
                            : "—"}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
