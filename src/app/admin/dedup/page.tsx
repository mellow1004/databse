import { db } from "@/lib/db";
import { findAllDuplicates } from "@/services/dedup";
import DedupReviewer from "./DedupReviewer";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  clientId?: string;
  minConfidence?: string;
  type?: string;
}>;

type FilterType = "all" | "contact" | "company";

function parseMinConfidence(raw: string | undefined): number {
  const n = Number(raw ?? "0.85");
  if (!Number.isFinite(n)) return 0.85;
  return Math.min(1, Math.max(0.5, n));
}

function parseType(raw: string | undefined): FilterType {
  const t = (raw ?? "all").toLowerCase();
  return t === "contact" || t === "company" ? t : "all";
}

export default async function DedupPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;

  const clients = await db.client.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  if (clients.length === 0) {
    return (
      <main className="min-h-screen max-w-6xl mx-auto p-8">
        <h1 className="text-2xl font-semibold">Duplicate review</h1>
        <p className="mt-2 text-sm text-gray-600">
          No clients in the database. Run <code className="font-mono">npm run db:seed</code> first.
        </p>
      </main>
    );
  }

  const currentClientId =
    sp.clientId && clients.some((c) => c.id === sp.clientId)
      ? sp.clientId
      : clients[0]!.id;
  const currentMinConfidence = parseMinConfidence(sp.minConfidence);
  const currentType = parseType(sp.type);

  const allCandidates = await findAllDuplicates(currentClientId);
  const filtered = allCandidates.filter((c) => {
    if (c.confidence < currentMinConfidence) return false;
    if (currentType !== "all" && c.type !== currentType) return false;
    return true;
  });

  return (
    <main className="min-h-screen max-w-6xl mx-auto p-8">
      <h1 className="text-2xl font-semibold">Duplicate review</h1>
      <p className="mt-2 text-sm text-gray-600 mb-6">
        Inspect duplicate candidates surfaced by the dedup detection engine.
        Survivor wins by default — flip toggles to take values from the
        merged-from record. Every merge is logged in{" "}
        <code className="font-mono">merge_history</code>.
      </p>
      <DedupReviewer
        candidates={filtered}
        clients={clients}
        currentClientId={currentClientId}
        currentMinConfidence={currentMinConfidence}
        currentType={currentType}
      />
    </main>
  );
}
