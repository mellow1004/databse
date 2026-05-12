"use client";

import { useRouter, usePathname } from "next/navigation";

export type ClientOption = { id: string; name: string };

type Props = {
  clients: ClientOption[];
  selectedClientId: string; // "" for "All clients"
  selectedScope: "all" | "global" | "client_level" | "domain_level";
  selectedStatus: "active" | "released" | "all";
};

/**
 * Sticky filter bar — every change immediately pushes a new URL so the
 * server component re-fetches with the new filters. Using router.push keeps
 * the URL shareable and back-button-friendly.
 */
export default function FilterBar({
  clients,
  selectedClientId,
  selectedScope,
  selectedStatus,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();

  function push(next: {
    clientId?: string;
    scope?: string;
    status?: string;
  }) {
    const params = new URLSearchParams();
    const clientId = next.clientId ?? selectedClientId;
    const scope = next.scope ?? selectedScope;
    const status = next.status ?? selectedStatus;
    if (clientId) params.set("clientId", clientId);
    if (scope && scope !== "all") params.set("scope", scope);
    if (status && status !== "active") params.set("status", status);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="sticky top-0 z-10 -mx-8 mb-4 border-b bg-white px-8 py-3 flex flex-wrap items-center gap-4 text-sm">
      <label className="flex items-center gap-2">
        <span className="text-xs text-gray-600">Client</span>
        <select
          value={selectedClientId}
          onChange={(e) => push({ clientId: e.target.value })}
          className="rounded border px-2 py-1 text-sm"
        >
          <option value="">All clients</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2">
        <span className="text-xs text-gray-600">Scope</span>
        <select
          value={selectedScope}
          onChange={(e) => push({ scope: e.target.value })}
          className="rounded border px-2 py-1 text-sm"
        >
          <option value="all">All</option>
          <option value="global">Global</option>
          <option value="client_level">Client</option>
          <option value="domain_level">Domain</option>
        </select>
      </label>

      <label className="flex items-center gap-2">
        <span className="text-xs text-gray-600">Status</span>
        <select
          value={selectedStatus}
          onChange={(e) => push({ status: e.target.value })}
          className="rounded border px-2 py-1 text-sm"
        >
          <option value="active">Active</option>
          <option value="released">Released</option>
          <option value="all">All</option>
        </select>
      </label>
    </div>
  );
}
