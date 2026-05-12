import Link from "next/link";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import AddSuppressionForm from "./AddSuppressionForm";
import FilterBar from "./FilterBar";
import ReleaseButton from "./ReleaseButton";

export const dynamic = "force-dynamic";

type ScopeFilter = "all" | "global" | "client_level" | "domain_level";
type StatusFilter = "active" | "released" | "all";

const SCOPE_BADGE: Record<string, string> = {
  global: "bg-red-100 text-red-800 ring-1 ring-red-200",
  client_level: "bg-orange-100 text-orange-800 ring-1 ring-orange-200",
  domain_level: "bg-purple-100 text-purple-800 ring-1 ring-purple-200",
};

function scopeBadge(scope: string) {
  const cls = SCOPE_BADGE[scope] ?? "bg-gray-100 text-gray-800 ring-1 ring-gray-200";
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {scope}
    </span>
  );
}

function statusBadge(status: string) {
  const cls =
    status === "active"
      ? "bg-green-100 text-green-800 ring-1 ring-green-200"
      : "bg-gray-100 text-gray-700 ring-1 ring-gray-200";
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

function fmtDateShort(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}

function targetCell(row: { contactId: string | null; email: string | null; domain: string | null; scope: string }) {
  if (row.contactId) {
    return (
      <span>
        <span className="text-xs text-gray-500">contact</span>{" "}
        <Link
          href={`/admin/contacts/${row.contactId}`}
          className="font-mono text-xs underline text-blue-700 hover:text-blue-800"
        >
          {row.contactId.slice(0, 10)}…
        </Link>
      </span>
    );
  }
  if (row.email) {
    return (
      <span>
        <span className="text-xs text-gray-500">email</span>{" "}
        <span className="font-mono text-xs">{row.email}</span>
      </span>
    );
  }
  if (row.domain) {
    return (
      <span>
        <span className="text-xs text-gray-500">domain</span>{" "}
        <span className="font-mono text-xs">{row.domain}</span>
      </span>
    );
  }
  if (row.scope === "client_level") {
    return (
      <span className="text-xs italic text-gray-500">
        (broad-client block — all contacts)
      </span>
    );
  }
  return <span className="text-xs text-gray-500">—</span>;
}

function coolingCell(row: {
  isOptOut: boolean;
  coolingPeriodIndefinite: boolean;
  reviewRequiredBefore: Date | null;
}) {
  if (!row.isOptOut) return <span className="text-xs text-gray-400">—</span>;
  if (row.coolingPeriodIndefinite) {
    return <span className="text-xs">Indefinite</span>;
  }
  if (!row.reviewRequiredBefore) {
    return <span className="text-xs text-gray-400">—</span>;
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

  // ---- Build the Prisma WHERE clause ----
  // The clientId filter is tricky: client_level rows belong to a specific
  // client, but global/domain_level rows affect every client. When the user
  // picks a client we therefore keep those latter two scopes visible.
  const where: Prisma.SuppressionWhereInput = {};
  if (selectedStatus !== "all") where.releaseStatus = selectedStatus;
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

  // Resolve foreign keys in a couple of small batched lookups.
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
  const totalReleased = rows.length - totalActive;

  return (
    <main className="min-h-screen max-w-6xl mx-auto p-8">
      <h1 className="text-2xl font-semibold">Manage suppressions</h1>
      <p className="mt-2 text-sm text-gray-600">
        Module 4 — global, client-level, and domain-level blocks. Releases
        require a reason and are written to the audit log.
      </p>

      <FilterBar
        clients={clients}
        selectedClientId={selectedClientId}
        selectedScope={selectedScope}
        selectedStatus={selectedStatus}
      />

      <p className="mb-4 text-sm text-gray-700">
        Showing <span className="tabular-nums font-medium">{rows.length}</span>{" "}
        suppression{rows.length === 1 ? "" : "s"} (
        <span className="tabular-nums">{totalActive}</span> active,{" "}
        <span className="tabular-nums">{totalReleased}</span> released).
      </p>

      <div className="mb-6">
        <AddSuppressionForm
          clients={clients.map((c) => ({ id: c.id, name: c.name }))}
        />
      </div>

      <div className="border rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Scope</th>
              <th className="px-3 py-2 font-medium">Target</th>
              <th className="px-3 py-2 font-medium">Reason</th>
              <th className="px-3 py-2 font-medium">Owner</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Cooling</th>
              <th className="px-3 py-2 font-medium">Added</th>
              <th className="px-3 py-2 font-medium w-36">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-8 text-center text-sm text-gray-500"
                >
                  No suppressions match these filters.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const ownerInfo = ownerById.get(r.owner);
                const clientName = r.clientId ? clientById.get(r.clientId) : null;
                return (
                  <tr key={r.id} className="border-b last:border-b-0 align-top">
                    <td className="px-3 py-2">
                      <div className="space-y-1">
                        {scopeBadge(r.scope)}
                        {clientName && (
                          <div className="text-xs text-gray-500">{clientName}</div>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">{targetCell(r)}</td>
                    <td className="px-3 py-2">
                      <div className="space-y-1">
                        <div className="text-xs font-medium">{r.reasonCode}</div>
                        {r.reasonDetail && (
                          <div className="text-xs text-gray-600">
                            {r.reasonDetail}
                          </div>
                        )}
                        <div className="text-[10px] uppercase tracking-wide text-gray-400">
                          {r.source}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-xs">
                        {ownerInfo?.fullName ?? (
                          <span className="font-mono">{r.owner.slice(0, 8)}…</span>
                        )}
                      </div>
                      {ownerInfo?.email && (
                        <div className="text-[10px] text-gray-500">
                          {ownerInfo.email}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="space-y-1">
                        {statusBadge(r.releaseStatus)}
                        {r.isOptOut && (
                          <div
                            className="text-xs"
                            title="Opt-out — bypasses scope rules"
                          >
                            ⚠️ opt-out
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">{coolingCell(r)}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      {fmtDateShort(r.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      {r.releaseStatus === "active" ? (
                        <ReleaseButton suppressionId={r.id} />
                      ) : (
                        <div className="text-xs text-gray-500">
                          Released {fmtDateShort(r.releasedAt)}
                          {ownerById.get(r.releasedBy ?? "") && (
                            <div className="text-[10px] text-gray-400">
                              by {ownerById.get(r.releasedBy ?? "")!.fullName}
                            </div>
                          )}
                          {r.releaseReason && (
                            <div className="text-[10px] text-gray-500 mt-1 italic">
                              “{r.releaseReason}”
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-6 text-sm">
        <Link href="/" className="text-blue-600 underline">
          ← Back to home
        </Link>
      </p>
    </main>
  );
}
