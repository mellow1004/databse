import Link from "next/link";
import { Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/lib/db";
import { getStatusVariant } from "@/lib/badge-helpers";

export const dynamic = "force-dynamic";

const SOURCE_LABELS: Record<string, string> = {
  crm_export: "CRM export",
  campaign_file: "Campaign file",
  spreadsheet: "Spreadsheet",
  vendor_export: "Vendor export",
  manual: "Manual",
};

function formatDate(d: Date): string {
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

export default async function BatchesListPage() {
  const [batches, clients] = await Promise.all([
    db.importBatch.findMany({ orderBy: { startedAt: "desc" } }),
    db.client.findMany({ select: { id: true, name: true } }),
  ]);
  const clientName = new Map(clients.map((c) => [c.id, c.name]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mt-1 text-sm text-slate-600">
            All CSV imports across all clients, newest first.
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/intake/upload">New upload</Link>
        </Button>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-0">
          {batches.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
              <Upload className="size-12 text-slate-300" aria-hidden />
              <div>
                <p className="text-sm font-medium text-slate-800">No batches yet</p>
                <p className="mt-1 text-sm text-slate-600">
                  Upload a CSV to create your first import batch.
                </p>
              </div>
              <Button asChild>
                <Link href="/admin/intake/upload">Upload your first CSV</Link>
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File name</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Accepted</TableHead>
                  <TableHead className="text-right">Rejected</TableHead>
                <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                    <span className="font-medium text-slate-900">
                      <Link
                        href={`/admin/intake/batches/${b.id}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {b.fileName}
                      </Link>
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {b.rowsTotal} rows
                    </span>
                    </TableCell>
                    <TableCell className="text-slate-700">
                      {clientName.get(b.clientId) ?? b.clientId}
                    </TableCell>
                    <TableCell className="text-slate-700">
                      {SOURCE_LABELS[b.source] ?? b.source}
                    </TableCell>
                    <TableCell className="tabular-nums text-slate-700">
                      {formatDate(b.startedAt)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {b.rowsTotal}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-700">
                      {b.rowsAccepted}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-rose-700">
                      {b.rowsRejected}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge className={getStatusVariant(b.status)}>{b.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
