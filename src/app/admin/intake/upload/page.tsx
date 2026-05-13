import { db } from "@/lib/db";
import UploadForm from "./UploadForm";

export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const clients = await db.client.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Upload CSV</h1>
        <p className="mt-1 text-sm text-slate-600">
          Raw CSV intake (Module 1). Rows are normalised, validated, and staged
          for review. Tombstoned identifiers and in-batch duplicates are rejected
          at write time. Nothing is promoted into contacts/companies in this
          phase.
        </p>
      </div>

      <UploadForm clients={clients} />

      <p className="text-xs text-slate-400">
        Acting as the seeded <code className="font-mono">data_owner</code> user.
        Real auth lands in a later phase.
      </p>
    </div>
  );
}
