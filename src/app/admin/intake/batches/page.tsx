import Link from "next/link";
import { db } from "@/lib/db";

// New batches must appear immediately after upload, so bypass caching.
export const dynamic = "force-dynamic";

const SOURCE_LABELS: Record<string, string> = {
  crm_export: "CRM export",
  campaign_file: "Campaign file",
  spreadsheet: "Spreadsheet",
  vendor_export: "Vendor export",
  manual: "Manual",
};

const STATUS_BADGE: Record<string, string> = {
  uploaded: "bg-gray-100 text-gray-700",
  parsing: "bg-gray-100 text-gray-700",
  ready_for_review: "bg-blue-100 text-blue-800",
  promoting: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
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
    <main className="min-h-screen max-w-6xl mx-auto p-8">
      <h1 className="text-2xl font-semibold mb-2">Import batches</h1>
      <p className="text-sm text-gray-600 mb-6">
        All CSV imports across all clients, newest first.
      </p>

      {batches.length === 0 ? (
        <div className="border rounded p-8 text-center text-sm text-gray-600">
          <p>No batches yet.</p>
          <Link
            href="/admin/intake/upload"
            className="mt-3 inline-block text-blue-600 underline"
          >
            Upload a CSV
          </Link>
        </div>
      ) : (
        <div className="border rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">File name</th>
                <th className="px-3 py-2 font-medium">Client</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Uploaded</th>
                <th className="px-3 py-2 font-medium text-right">Total</th>
                <th className="px-3 py-2 font-medium text-right">Accepted</th>
                <th className="px-3 py-2 font-medium text-right">Rejected</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className="border-b last:border-b-0 hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <Link
                      href={`/admin/intake/batches/${b.id}`}
                      className="text-blue-600 underline"
                    >
                      {b.fileName}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {clientName.get(b.clientId) ?? b.clientId}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {SOURCE_LABELS[b.source] ?? b.source}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {formatDate(b.startedAt)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {b.rowsTotal}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-green-700">
                    {b.rowsAccepted}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-red-700">
                    {b.rowsRejected}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`text-xs px-2 py-1 rounded ${
                        STATUS_BADGE[b.status] ?? "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {b.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-6 text-xs text-gray-400">
        <Link href="/admin/intake/upload" className="text-blue-600 underline">
          Upload another CSV
        </Link>
      </p>
    </main>
  );
}
