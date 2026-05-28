import { db } from "@/lib/db";
import { findAllDuplicates, type DedupCandidate } from "@/services/dedup";
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

function fieldsFromRaw(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.field === "string") return [parsed.field];
    if (parsed?.fields && typeof parsed.fields === "object") {
      return Object.entries(parsed.fields)
        .filter(([, value]) => value !== null && value !== undefined && value !== "")
        .map(([field]) => field);
    }
    return [];
  } catch {
    return [];
  }
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
  const contactIds = Array.from(
    new Set(
      filtered
        .filter((c) => c.type === "contact")
        .flatMap((c) => [c.survivorId, c.mergedFromId]),
    ),
  );
  const [enrichmentRows, verificationRows] = await Promise.all([
    contactIds.length
      ? db.enrichmentLog.findMany({
          where: {
            contactId: { in: contactIds },
            status: { in: ["success", "conflict_pending", "conflict_resolved"] },
          },
          orderBy: { createdAt: "desc" },
          select: {
            contactId: true,
            provider: true,
            rawResponse: true,
            createdAt: true,
          },
        })
      : [],
    contactIds.length
      ? db.verification.findMany({
          where: { contactId: { in: contactIds } },
          orderBy: { createdAt: "desc" },
          select: { contactId: true, createdAt: true },
        })
      : [],
  ]);

  const latestVerificationByContact = new Map<string, string>();
  for (const row of verificationRows) {
    if (!latestVerificationByContact.has(row.contactId)) {
      latestVerificationByContact.set(row.contactId, relativeTime(row.createdAt));
    }
  }

  const sourceByContactAndField = new Map<string, string>();
  for (const row of enrichmentRows) {
    if (!row.contactId) continue;
    const fields = fieldsFromRaw(row.rawResponse);
    for (const field of fields) {
      const key = `${row.contactId}::${field}`;
      if (!sourceByContactAndField.has(key)) {
        sourceByContactAndField.set(key, row.provider);
      }
    }
  }

  const enrichedCandidates: DedupCandidate[] = filtered.map((candidate) => {
    if (candidate.type !== "contact") return candidate;
    const verifiedLabel = latestVerificationByContact.get(candidate.survivorId) ?? "—";
    return {
      ...candidate,
      fieldComparison: candidate.fieldComparison.map((fc) => ({
        ...fc,
        source: sourceByContactAndField.get(`${candidate.survivorId}::${fc.field}`) ?? "—",
        verified: verifiedLabel,
      })),
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-600">
          Identified candidate merges across master data, sorted by confidence.
        </p>
      </div>
      <DedupReviewer
        candidates={enrichedCandidates}
        clients={clients}
        currentClientId={currentClientId}
        currentMinConfidence={currentMinConfidence}
        currentType={currentType}
      />
    </div>
  );
}
