import { db } from "@/lib/db";
import UploadForm from "./UploadForm";

// Client list must reflect live seed/wipe activity, so bypass any caching.
export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const clients = await db.client.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <main className="min-h-screen max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-semibold">Upload CSV</h1>
      <p className="mt-2 text-gray-600 text-sm">
        Raw CSV intake (Module 1). Rows are normalised, validated, and staged
        for review. Tombstoned identifiers and in-batch duplicates are rejected
        at write time. Nothing is promoted into contacts/companies in this
        phase.
      </p>

      <div className="mt-6">
        <UploadForm clients={clients} />
      </div>

      <p className="mt-8 text-xs text-gray-400">
        Acting as the seeded <code>data_owner</code> user. Real auth lands in a
        later phase.
      </p>
    </main>
  );
}
