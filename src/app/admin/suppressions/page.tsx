import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import type { Prisma } from "@prisma/client";
import {
  getStatusVariant,
  getSuppressionScopeVariant,
} from "@/lib/badge-helpers";
import AddSuppressionForm from "./AddSuppressionForm";
import FilterBar from "./FilterBar";
import ReleaseButton from "./ReleaseButton";

export const dynamic = "force-dynamic";

type ScopeFilter = "all" | "global" | "client_level" | "domain_level";
type StatusFilter = "active" | "released" | "all";

function relativeTime(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

function fmtDateShort(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}

function targetCell(row: {
  contactId: string | null;
  email: string | null;
  domain: string | null;
  scope: string;
}) {
  if (row.contactId) {
    return (
      <span>
        <span className="text-xs text-muted-foreground">contact</span>{" "}
        <Link
          href={`/admin/contacts/${row.contactId}`}
          className="font-mono text-xs text-primary underline-offset-4 hover:underline"
        >
          {row.contactId.slice(0, 10)}…
        </Link>
      </span>
    );
  }
  if (row.email) {
    return (
      <span>
        <span className="text-xs text-muted-foreground">email</span>{" "}
        <span className="font-mono text-xs">{row.email}</span>
      </span>
    );
  }
  if (row.domain) {
    return (
      <span>
        <span className="text-xs text-muted-foreground">domain</span>{" "}
        <span className="font-mono text-xs">{row.domain}</span>
      </span>
    );
  }
  if (row.scope === "client_level") {
    return (
      <span className="text-xs italic text-muted-foreground">
        (broad-client block — all contacts)
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">—</span>;
}

function coolingCell(row: {
  isOptOut: boolean;
  coolingPeriodIndefinite: boolean;
  reviewRequiredBefore: Date | null;
}) {
  if (!row.isOptOut) return <span className="text-xs text-muted-foreground">—</span>;
  if (row.coolingPeriodIndefinite) {
    return <span className="text-xs">Indefinite</span>;
  }
  if (!row.reviewRequiredBefore) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  if (row.reviewRequiredBefore.getTime() < Date.now()) {
    return (
      <span className="text-xs text-amber-700">
        Cooling expired ({fmtDateShort(row.reviewRequiredBefore)})
      </span>
    );
  }
  return <span className="text-xs">Until {fmtDateShort(row.reviewRequiredBefore)}</span>;
}

export default async function SuppressionsPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string; scope?: string; status?: string }>;
}) {
  const sp = await searchParams;

  const clients = await db.client.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  if (clients.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Suppressions</h1>
          <p className="text-sm text-slate-600">
            No clients found — run <code className="font-mono text-xs">npm run db:seed</code>{" "}
            first.
          </p>
        </div>
      </div>
    );
  }

  const requestedClientId = sp.clientId ?? "";
  const selectedClientId =
    requestedClientId && clients.some((c) => c.id === requestedClientId)
      ? requestedClientId
      : "";

  const requestedScope = (sp.scope ?? "all") as ScopeFilter;
  const selectedScope: ScopeFilter =
    requestedScope === "global" ||
    requestedScope === "client_level" ||
    requestedScope === "domain_level"
      ? requestedScope
      : "all";

  const requestedStatus = (sp.status ?? "active") as StatusFilter;
  const selectedStatus: StatusFilter =
    requestedStatus === "released" || requestedStatus === "all"
      ? requestedStatus
      : "active";

  const where: Prisma.SuppressionWhereInput = {};
  if (selectedStatus === "active") {
    where.releaseStatus = { in: ["active", "request_pending"] };
  } else if (selectedStatus === "released") {
    where.releaseStatus = "released";
  }
  if (selectedScope !== "all") where.scope = selectedScope;
  if (selectedClientId) {
    where.OR = [
      { clientId: selectedClientId },
      { scope: { in: ["global", "domain_level"] } },
    ];
  }

  const rows = await db.suppression.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });

  const ownerIds = Array.from(
    new Set(rows.flatMap((r) => [r.owner, r.releasedBy].filter(Boolean) as string[])),
  );
  const owners = ownerIds.length
    ? await db.user.findMany({
        where: { id: { in: ownerIds } },
        select: { id: true, fullName: true, email: true },
      })
    : [];
  const ownerById = new Map(owners.map((u) => [u.id, u]));

  const clientById = new Map(clients.map((c) => [c.id, c.name]));

  const totalActive = rows.filter((r) => r.releaseStatus === "active").length;
  const totalReleased = rows.filter((r) => r.releaseStatus === "released").length;
  const pendingApprovals = rows.filter((r) => r.releaseStatus === "request_pending").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Suppressions</h1>
        {pendingApprovals > 0 ? (
          <Badge className="border-transparent bg-amber-100 text-amber-800">
            {pendingApprovals} pending approvals
          </Badge>
        ) : null}
      </div>
      <div>
        <p className="text-sm text-slate-600">
          Three-scope do-not-contact rules: global, client-level, domain-level.
        </p>
      </div>

      <FilterBar
        clients={clients}
        selectedClientId={selectedClientId}
        selectedScope={selectedScope}
        selectedStatus={selectedStatus}
      />

      <p className="text-sm text-slate-600">
        Showing{" "}
        <span className="font-semibold tabular-nums text-slate-900">{rows.length}</span>{" "}
        suppression{rows.length === 1 ? "" : "s"} (
        <span className="tabular-nums">{totalActive}</span> active,{" "}
        <span className="tabular-nums">{totalReleased}</span> released,{" "}
        <span className="tabular-nums">{pendingApprovals}</span> pending).
      </p>

      <AddSuppressionForm clients={clients.map((c) => ({ id: c.id, name: c.name }))} />

      <Card className="shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Scope</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Cooling</TableHead>
                <TableHead>Added</TableHead>
                <TableHead className="w-40">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-12 text-center text-sm text-slate-600">
                    No suppressions match these filters.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => {
                  const ownerInfo = ownerById.get(r.owner);
                  const clientName = r.clientId ? clientById.get(r.clientId) : null;
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="align-top">
                        <div className="space-y-1">
                          <Badge className={getSuppressionScopeVariant(r.scope)}>
                            {r.scope}
                          </Badge>
                          {clientName ? (
                            <div className="text-xs text-muted-foreground">{clientName}</div>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="align-top">{targetCell(r)}</TableCell>
                      <TableCell className="align-top">
                        <div className="space-y-1">
                          <div className="text-xs font-medium">{r.reasonCode}</div>
                          {r.reasonDetail ? (
                            <div className="text-xs text-muted-foreground">{r.reasonDetail}</div>
                          ) : null}
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            {r.source}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="text-xs">
                          {ownerInfo?.fullName ?? (
                            <span className="font-mono">{r.owner.slice(0, 8)}…</span>
                          )}
                        </div>
                        {ownerInfo?.email ? (
                          <div className="text-[10px] text-muted-foreground">
                            {ownerInfo.email}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge className={getStatusVariant(r.releaseStatus)}>
                            {r.releaseStatus}
                          </Badge>
                          {r.releaseStatus === "request_pending" ? (
                            <span className="text-xs text-amber-700">Awaiting approval</span>
                          ) : null}
                          {r.isOptOut ? (
                            <span
                              className="inline-flex text-amber-600"
                              title="Opt-out — regulatory; bypasses scope rules"
                            >
                              <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="align-top">{coolingCell(r)}</TableCell>
                      <TableCell className="align-top text-xs tabular-nums text-muted-foreground">
                        {relativeTime(r.createdAt)}
                      </TableCell>
                      <TableCell className="align-top">
                        {r.releaseStatus === "active" || r.releaseStatus === "request_pending" ? (
                          <ReleaseButton
                            suppressionId={r.id}
                            scope={r.scope}
                            reasonCode={r.reasonCode}
                            isOptOut={r.isOptOut}
                            releaseStatus={r.releaseStatus}
                          />
                        ) : (
                          <div className="text-xs text-muted-foreground">
                            <div>
                              Released {fmtDateShort(r.releasedAt)} by{" "}
                              {r.releasedBy
                                ? (ownerById.get(r.releasedBy)?.fullName ??
                                  `${r.releasedBy.slice(0, 8)}…`)
                                : "—"}
                            </div>
                            {r.releaseReason ? (
                              <div className="mt-1 text-[11px] italic">
                                &ldquo;{r.releaseReason}&rdquo;
                              </div>
                            ) : null}
                          </div>
                        )}
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
