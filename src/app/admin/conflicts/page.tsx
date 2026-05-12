import Link from "next/link";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

function parseField(raw: string | null): string {
  if (!raw) return "—";
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.field === "string") return parsed.field;
  } catch {
    /* fall through */
  }
  return "—";
}

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

export default async function ConflictsQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string }>;
}) {
  const sp = await searchParams;

  const clients = await db.client.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  if (clients.length === 0) {
    return (
      <main className="min-h-screen max-w-6xl mx-auto p-8">
        <h1 className="text-2xl font-semibold">Resolve enrichment conflicts</h1>
        <p className="mt-4 text-sm text-gray-600">
          No clients found — run <code>npm run db:seed</code> first.
        </p>
      </main>
    );
  }
  const currentClientId =
    sp.clientId && clients.some((c) => c.id === sp.clientId)
      ? sp.clientId
      : clients[0]!.id;
  const currentClient = clients.find((c) => c.id === currentClientId)!;

  const rows = await db.enrichmentLog.findMany({
    where: { clientId: currentClientId, status: "conflict_pending" },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const contactIds = Array.from(
    new Set(rows.map((r) => r.contactId).filter((id): id is string => Boolean(id))),
  );

  const contacts = contactIds.length
    ? await db.contact.findMany({
        where: { id: { in: contactIds } },
        include: {
          person: { select: { fullName: true } },
          company: { select: { legalName: true } },
        },
      })
    : [];
  const contactsById = new Map(contacts.map((c) => [c.id, c]));

  const distinctContacts = new Set(contactIds).size;

  return (
    <main className="min-h-screen max-w-6xl mx-auto p-8">
      <h1 className="text-2xl font-semibold">Resolve enrichment conflicts</h1>
      <p className="mt-2 text-sm text-gray-600">
        Module 3 — fields where Cognism and Apollo disagreed and the
        confidence delta fell under 15%. Pick a survivor on the contact's
        detail page.
      </p>

      {/* ---- Filter bar ---- */}
      <div className="mt-6 flex items-center gap-3 text-sm">
        <label className="text-gray-600">Client</label>
        <form method="get" className="flex items-center gap-2">
          <select
            name="clientId"
            defaultValue={currentClientId}
            className="rounded border px-2 py-1 text-sm"
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded bg-gray-100 hover:bg-gray-200 text-xs px-3 py-1"
          >
            Apply
          </button>
        </form>
      </div>

      <p className="mt-4 text-sm text-gray-700">
        <span className="tabular-nums font-medium">{rows.length}</span> conflict
        {rows.length === 1 ? "" : "s"} pending across{" "}
        <span className="tabular-nums font-medium">{distinctContacts}</span>{" "}
        contact{distinctContacts === 1 ? "" : "s"} in{" "}
        <span className="font-medium">{currentClient.name}</span>.
      </p>

      {/* ---- Conflicts table ---- */}
      <div className="mt-4 border rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Contact</th>
              <th className="px-3 py-2 font-medium">Company</th>
              <th className="px-3 py-2 font-medium">Field</th>
              <th className="px-3 py-2 font-medium">Detected</th>
              <th className="px-3 py-2 font-medium w-20">Resolve</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-8 text-center text-sm text-gray-500"
                >
                  No conflicts pending in this client.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const c = r.contactId ? contactsById.get(r.contactId) : null;
                const name = c?.person.fullName ?? "(missing contact)";
                const company = c?.company.legalName ?? "—";
                const field = parseField(r.rawResponse);
                return (
                  <tr key={r.id} className="border-b">
                    <td className="px-3 py-2">
                      {r.contactId ? (
                        <Link
                          href={`/admin/contacts/${r.contactId}`}
                          className="text-blue-600 underline"
                        >
                          {name}
                        </Link>
                      ) : (
                        name
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-700">{company}</td>
                    <td className="px-3 py-2">
                      <code className="font-mono text-xs">{field}</code>
                    </td>
                    <td className="px-3 py-2 text-gray-700 tabular-nums">
                      {relativeTime(r.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      {r.contactId ? (
                        <Link
                          href={`/admin/contacts/${r.contactId}#conflicts`}
                          className="text-blue-600 underline text-xs"
                        >
                          Resolve →
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-6">
        <Link href="/" className="text-blue-600 underline text-sm">
          ← Back to home
        </Link>
      </p>
    </main>
  );
}
