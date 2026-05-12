import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import ConflictCard, { type ConflictCardProps } from "./ConflictCard";

// Detail counts + freshly-resolved conflicts must reflect the very latest
// write, so bypass the App Router cache.
export const dynamic = "force-dynamic";

const GATE_BADGE: Record<string, string> = {
  gate_0: "bg-gray-100 text-gray-800",
  gate_1: "bg-yellow-100 text-yellow-900",
  gate_2: "bg-green-100 text-green-900",
  gate_3: "bg-emerald-100 text-emerald-900",
  quarantine: "bg-red-100 text-red-900",
};

const VERIFICATION_STATUS_BADGE: Record<string, string> = {
  valid: "bg-green-100 text-green-800",
  invalid: "bg-red-100 text-red-800",
  risky: "bg-yellow-100 text-yellow-800",
  unknown: "bg-yellow-100 text-yellow-800",
  catch_all: "bg-yellow-100 text-yellow-800",
  disposable: "bg-gray-100 text-gray-800",
};

const ENRICHMENT_STATUS_BADGE: Record<string, string> = {
  success: "bg-green-100 text-green-800",
  no_match: "bg-gray-100 text-gray-700",
  conflict_pending: "bg-amber-100 text-amber-800",
  conflict_resolved: "bg-blue-100 text-blue-800",
  rate_limited: "bg-yellow-100 text-yellow-800",
  error: "bg-red-100 text-red-800",
  rolled_back: "bg-purple-100 text-purple-800",
};

function relativeTime(d: Date | null): string {
  if (!d) return "—";
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

function parseFieldsFilled(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((s) => typeof s === "string");
    return [];
  } catch {
    return [];
  }
}

type ConflictRaw = {
  field: string;
  primary: { provider: string; value: string | null; confidence: number };
  secondary: { provider: string; value: string | null; confidence: number };
  delta: number;
};

/** Map the (primary | secondary) sides of a conflict row to (cognism | apollo). */
function conflictToCardProps(
  enrichmentLogId: string,
  raw: string,
): ConflictCardProps | null {
  let parsed: ConflictRaw;
  try {
    parsed = JSON.parse(raw) as ConflictRaw;
  } catch {
    return null;
  }
  if (
    !parsed?.field ||
    !parsed.primary ||
    !parsed.secondary ||
    typeof parsed.primary.provider !== "string" ||
    typeof parsed.secondary.provider !== "string"
  ) {
    return null;
  }
  const sides = [parsed.primary, parsed.secondary];
  const cognism = sides.find((s) => s.provider === "cognism");
  const apollo = sides.find((s) => s.provider === "apollo");
  if (!cognism || !apollo) return null;
  return {
    enrichmentLogId,
    field: parsed.field,
    cognism: { value: cognism.value, confidence: cognism.confidence },
    apollo: { value: apollo.value, confidence: apollo.confidence },
    delta: parsed.delta ?? Math.abs(cognism.confidence - apollo.confidence),
  };
}

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const contact = await db.contact.findUnique({
    where: { id },
    include: {
      person: true,
      company: true,
    },
  });
  if (!contact) notFound();

  const [verifications, enrichmentLogs, gateHistory, survivor] = await Promise.all([
    db.verification.findMany({
      where: { contactId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.enrichmentLog.findMany({
      where: { contactId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.gateStatusHistory.findMany({
      where: { contactId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    contact.mergedIntoId
      ? db.contact.findUnique({
          where: { id: contact.mergedIntoId },
          include: { person: { select: { fullName: true } } },
        })
      : null,
  ]);

  const pendingConflicts = enrichmentLogs.filter((r) => r.status === "conflict_pending");
  const pendingCards = pendingConflicts
    .map((r) =>
      r.rawResponse ? conflictToCardProps(r.id, r.rawResponse) : null,
    )
    .filter((p): p is ConflictCardProps => p !== null);

  return (
    <main className="min-h-screen max-w-6xl mx-auto p-8">
      {survivor && (
        <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Soft-archived — merged into{" "}
          <Link
            href={`/admin/contacts/${survivor.id}`}
            className="underline font-medium"
          >
            {survivor.person.fullName}
          </Link>
        </div>
      )}

      {/* ---- Header card ---- */}
      <div className="border rounded p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{contact.person.fullName}</h1>
            <p className="text-sm text-gray-600">
              {contact.title ?? <span className="italic text-gray-400">(no title)</span>}
              {contact.title && contact.company?.legalName ? " · " : ""}
              {contact.company?.legalName}
              {contact.company?.country ? ` (${contact.company.country})` : ""}
            </p>
          </div>
          <span
            className={`text-xs px-2 py-1 rounded ${
              GATE_BADGE[contact.gateStatus] ?? "bg-gray-100 text-gray-700"
            }`}
          >
            {contact.gateStatus}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <dl className="space-y-1">
            <div className="flex">
              <dt className="w-32 text-gray-500">Email</dt>
              <dd className="break-all">{contact.email ?? "—"}</dd>
            </div>
            <div className="flex">
              <dt className="w-32 text-gray-500">Phone</dt>
              <dd>{contact.phone ?? "—"}</dd>
            </div>
            <div className="flex">
              <dt className="w-32 text-gray-500">LinkedIn</dt>
              <dd className="break-all">
                {contact.person.linkedinUrl ? (
                  <a
                    href={
                      contact.person.linkedinUrl.startsWith("http")
                        ? contact.person.linkedinUrl
                        : `https://${contact.person.linkedinUrl}`
                    }
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 underline"
                  >
                    {contact.person.linkedinUrl}
                  </a>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div className="flex">
              <dt className="w-32 text-gray-500">Seniority</dt>
              <dd>{contact.seniority ?? "—"}</dd>
            </div>
          </dl>

          <dl className="space-y-1">
            <div className="flex">
              <dt className="w-32 text-gray-500">Last verified</dt>
              <dd className="tabular-nums">{relativeTime(contact.lastVerifiedAt)}</dd>
            </div>
            <div className="flex">
              <dt className="w-32 text-gray-500">Last enriched</dt>
              <dd className="tabular-nums">{relativeTime(contact.lastEnrichedAt)}</dd>
            </div>
            <div className="flex">
              <dt className="w-32 text-gray-500">Write source</dt>
              <dd>{contact.writeSource ?? "—"}</dd>
            </div>
            <div className="flex">
              <dt className="w-32 text-gray-500">Lifecycle</dt>
              <dd>{contact.lifecycleStage}</dd>
            </div>
          </dl>
        </div>

        {(contact.quarantineReason || contact.campaignActive) && (
          <div className="mt-4 flex flex-wrap gap-2">
            {contact.quarantineReason && (
              <span className="bg-red-100 text-red-800 text-xs px-2 py-1 rounded">
                Quarantined: {contact.quarantineReason}
              </span>
            )}
            {contact.campaignActive && (
              <span className="bg-purple-100 text-purple-800 text-xs px-2 py-1 rounded">
                Campaign active
              </span>
            )}
          </div>
        )}
      </div>

      {/* ---- Pending conflicts ---- */}
      {pendingCards.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">
            Pending conflicts{" "}
            <span className="text-sm font-normal text-gray-500">
              ({pendingCards.length})
            </span>
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Provider responses disagreed and the confidence delta fell under
            15%. Pick a survivor and record a reason; the resolution writes to
            audit_log.
          </p>
          <div className="mt-4">
            {pendingCards.map((card) => (
              <ConflictCard key={card.enrichmentLogId} {...card} />
            ))}
          </div>
        </section>
      )}

      {/* ---- Verification history ---- */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold">
          Verification history{" "}
          <span className="text-sm font-normal text-gray-500">
            ({verifications.length})
          </span>
        </h2>
        <div className="mt-3 border rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Provider</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Confidence</th>
                <th className="px-3 py-2 font-medium">Credits</th>
              </tr>
            </thead>
            <tbody>
              {verifications.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-6 text-center text-sm text-gray-500"
                  >
                    No verifications yet.
                  </td>
                </tr>
              ) : (
                verifications.map((v) => (
                  <tr key={v.id} className="border-b">
                    <td className="px-3 py-2 text-gray-700 tabular-nums">
                      {relativeTime(v.createdAt)}
                    </td>
                    <td className="px-3 py-2">{v.verificationType}</td>
                    <td className="px-3 py-2 font-mono text-xs">{v.provider}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`text-xs px-2 py-1 rounded ${
                          VERIFICATION_STATUS_BADGE[v.status] ??
                          "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {v.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {v.confidence !== null
                        ? `${(v.confidence * 100).toFixed(0)}%`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{v.creditsUsed}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- Enrichment history ---- */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold">
          Enrichment history{" "}
          <span className="text-sm font-normal text-gray-500">
            ({enrichmentLogs.length})
          </span>
        </h2>
        <div className="mt-3 border rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Provider</th>
                <th className="px-3 py-2 font-medium w-12">Step</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Confidence</th>
                <th className="px-3 py-2 font-medium">Credits</th>
                <th className="px-3 py-2 font-medium">Fields filled</th>
              </tr>
            </thead>
            <tbody>
              {enrichmentLogs.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-6 text-center text-sm text-gray-500"
                  >
                    No enrichment runs yet.
                  </td>
                </tr>
              ) : (
                enrichmentLogs.map((e) => {
                  const fields = parseFieldsFilled(e.fieldsFilled);
                  return (
                    <tr key={e.id} className="border-b align-top">
                      <td className="px-3 py-2 text-gray-700 tabular-nums">
                        {relativeTime(e.createdAt)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{e.provider}</td>
                      <td className="px-3 py-2 tabular-nums">{e.step}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`text-xs px-2 py-1 rounded ${
                            ENRICHMENT_STATUS_BADGE[e.status] ??
                            "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {e.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {e.confidence !== null
                          ? `${(e.confidence * 100).toFixed(0)}%`
                          : "—"}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{e.creditsUsed}</td>
                      <td className="px-3 py-2">
                        {fields.length === 0 ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {fields.map((f) => (
                              <span
                                key={f}
                                className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded font-mono"
                              >
                                {f}
                              </span>
                            ))}
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
      </section>

      {/* ---- Gate status history ---- */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold">
          Gate status history{" "}
          <span className="text-sm font-normal text-gray-500">
            ({gateHistory.length})
          </span>
        </h2>
        <div className="mt-3 border rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">From → To</th>
                <th className="px-3 py-2 font-medium">Reason</th>
                <th className="px-3 py-2 font-medium">Actor</th>
              </tr>
            </thead>
            <tbody>
              {gateHistory.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-3 py-6 text-center text-sm text-gray-500"
                  >
                    No gate transitions recorded yet.
                  </td>
                </tr>
              ) : (
                gateHistory.map((h) => (
                  <tr key={h.id} className="border-b">
                    <td className="px-3 py-2 text-gray-700 tabular-nums">
                      {relativeTime(h.createdAt)}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      <span className="font-mono text-xs">{h.fromGate ?? "—"}</span>
                      <span className="mx-2 text-gray-400">→</span>
                      <span className="font-mono text-xs">{h.toGate}</span>
                    </td>
                    <td className="px-3 py-2">{h.reason}</td>
                    <td className="px-3 py-2 font-mono text-xs">{h.actor}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p className="mt-8">
        <Link
          href="/admin/intake/batches"
          className="text-blue-600 underline text-sm"
        >
          ← Back to all batches
        </Link>
      </p>
    </main>
  );
}
