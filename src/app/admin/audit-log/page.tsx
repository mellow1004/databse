import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

function asDate(value: string | undefined, endOfDay = false): Date | null {
  if (!value) return null;
  const parsed = new Date(`${value}${endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z"}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resourceHref(resourceType: string, resourceId: string | null): string | null {
  if (!resourceId) return null;
  if (resourceType === "contact") return `/admin/contacts/${resourceId}`;
  if (resourceType === "import_batch") return `/admin/intake/batches/${resourceId}`;
  if (resourceType === "refresh_log") return "/admin/refresh-cycle";
  if (resourceType === "quarantine_log") return "/admin/quarantine";
  if (resourceType === "suppression") return "/admin/suppressions";
  if (resourceType === "company") return "/admin/dedup";
  return null;
}

export default async function AuditLogPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const actor = typeof searchParams.actor === "string" ? searchParams.actor : "";
  const action = typeof searchParams.action === "string" ? searchParams.action : "";
  const resourceType =
    typeof searchParams.resourceType === "string" ? searchParams.resourceType : "";
  const clientId = typeof searchParams.clientId === "string" ? searchParams.clientId : "";
  const from = typeof searchParams.from === "string" ? searchParams.from : "";
  const to = typeof searchParams.to === "string" ? searchParams.to : "";
  const pageRaw = typeof searchParams.page === "string" ? Number(searchParams.page) : 1;
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const where = {
    ...(actor ? { actorUserId: actor } : {}),
    ...(action ? { action } : {}),
    ...(resourceType ? { resourceType } : {}),
    ...(clientId ? { clientId } : {}),
    ...((from || to)
      ? {
          createdAt: {
            ...(from ? { gte: asDate(from) ?? undefined } : {}),
            ...(to ? { lte: asDate(to, true) ?? undefined } : {}),
          },
        }
      : {}),
  };

  const [rows, total, users, clients] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.auditLog.count({ where }),
    db.user.findMany({ select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
    db.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const actionOptions = await db.auditLog.findMany({
    distinct: ["action"],
    select: { action: true },
    orderBy: { action: "asc" },
    take: 100,
  });
  const resourceTypeOptions = await db.auditLog.findMany({
    distinct: ["resourceType"],
    select: { resourceType: true },
    orderBy: { resourceType: "asc" },
    take: 100,
  });
  const userById = new Map(users.map((u) => [u.id, u.fullName]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="text-sm text-slate-600">Filter and inspect immutable governance events.</p>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="GET" className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="space-y-1">
              <Label>Actor</Label>
              <Input name="actor" defaultValue={actor} placeholder="user id" />
            </div>
            <div className="space-y-1">
              <Label>Action</Label>
              <select name="action" defaultValue={action} className="h-9 w-full rounded-md border px-2 text-sm">
                <option value="">All</option>
                {actionOptions.map((a) => (
                  <option key={a.action} value={a.action}>{a.action}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Resource type</Label>
              <select name="resourceType" defaultValue={resourceType} className="h-9 w-full rounded-md border px-2 text-sm">
                <option value="">All</option>
                {resourceTypeOptions.map((r) => (
                  <option key={r.resourceType} value={r.resourceType}>{r.resourceType}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Client</Label>
              <select name="clientId" defaultValue={clientId} className="h-9 w-full rounded-md border px-2 text-sm">
                <option value="">All</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>From</Label>
              <Input type="date" name="from" defaultValue={from} />
            </div>
            <div className="space-y-1">
              <Label>To</Label>
              <Input type="date" name="to" defaultValue={to} />
            </div>
            <input type="hidden" name="page" value="1" />
            <button type="submit" className="hidden" aria-hidden />
          </form>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead>Client</TableHead>
                <TableHead className="text-right">Records</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No audit events match these filters.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const href = resourceHref(row.resourceType, row.resourceId);
                  const resourceLabel = row.resourceId
                    ? `${row.resourceType}:${row.resourceId.slice(-8)}`
                    : row.resourceType;
                  return (
                    <TableRow key={row.id}>
                      <TableCell>{row.createdAt.toISOString()}</TableCell>
                      <TableCell>{row.actorUserId ? (userById.get(row.actorUserId) ?? row.actorUserId) : "system"}</TableCell>
                      <TableCell>{row.action}</TableCell>
                      <TableCell>
                        {href ? <Link href={href} className="underline underline-offset-2">{resourceLabel}</Link> : resourceLabel}
                      </TableCell>
                      <TableCell>{row.clientId ? clients.find((c) => c.id === row.clientId)?.name ?? row.clientId : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.recordsAffected}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          Page {page} of {totalPages} ({total} rows)
        </span>
        <div className="flex gap-2">
          <Link
            href={`?actor=${encodeURIComponent(actor)}&action=${encodeURIComponent(action)}&resourceType=${encodeURIComponent(resourceType)}&clientId=${encodeURIComponent(clientId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&page=${Math.max(1, page - 1)}`}
            className={`rounded border px-3 py-1 ${page <= 1 ? "pointer-events-none opacity-50" : ""}`}
          >
            Previous
          </Link>
          <Link
            href={`?actor=${encodeURIComponent(actor)}&action=${encodeURIComponent(action)}&resourceType=${encodeURIComponent(resourceType)}&clientId=${encodeURIComponent(clientId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&page=${Math.min(totalPages, page + 1)}`}
            className={`rounded border px-3 py-1 ${page >= totalPages ? "pointer-events-none opacity-50" : ""}`}
          >
            Next
          </Link>
        </div>
      </div>
    </div>
  );
}
