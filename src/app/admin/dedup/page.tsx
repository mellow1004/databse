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

const THRESHOLDS = [0.5, 0.7, 0.85, 0.95] as const;

function parseMinConfidence(raw: string | undefined): number {
  const n = Number(raw);
  if (THRESHOLDS.includes(n as (typeof THRESHOLDS)[number])) {
    return n as (typeof THRESHOLDS)[number];
  }
  return 0.85;
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
      <div className="space-y-6">
        <div>
          <p className="text-sm text-slate-600">
            No clients in the database. Run{" "}
            <code className="font-mono text-xs">npm run db:seed</code> first.
          </p>
        </div>
      </div>
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
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-600">
          Identified candidate merges across master data, sorted by confidence.
        </p>
      </div>
      <DedupReviewer
        candidates={filtered}
        clients={clients}
        currentClientId={currentClientId}
        currentMinConfidence={currentMinConfidence}
        currentType={currentType}
      />
    </div>
  );
}
