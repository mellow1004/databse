import { db } from "@/lib/db";

// Always re-query — this is a debug/health page, never cache.
export const dynamic = "force-dynamic";

// ----------------------------------------------------------------------------
// Table-count loaders, grouped to match the three schema layers
// ----------------------------------------------------------------------------

async function loadCounts() {
  const [
    clients, persons, companies, domainAliases, contacts, ccRelationships,
    enrichmentLog, verifications, gateStatusHistory, mergeHistory, quarantineLog, refreshLog,
    suppressions, tombstones, users, rolePermissions, auditLog, integrationContracts,
    latestClient,
  ] = await Promise.all([
    db.client.count(),
    db.person.count(),
    db.company.count(),
    db.domainAlias.count(),
    db.contact.count(),
    db.contactCompanyRelationship.count(),
    db.enrichmentLog.count(),
    db.verification.count(),
    db.gateStatusHistory.count(),
    db.mergeHistory.count(),
    db.quarantineLog.count(),
    db.refreshLog.count(),
    db.suppression.count(),
    db.tombstone.count(),
    db.user.count(),
    db.rolePermission.count(),
    db.auditLog.count(),
    db.integrationContract.count(),
    db.client.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);

  return {
    identity: [
      { name: "clients", rows: clients },
      { name: "persons", rows: persons },
      { name: "companies", rows: companies },
      { name: "domain_aliases", rows: domainAliases },
      { name: "contacts", rows: contacts },
      { name: "contact_company_relationships", rows: ccRelationships },
    ],
    eventLog: [
      { name: "enrichment_log", rows: enrichmentLog },
      { name: "verifications", rows: verifications },
      { name: "gate_status_history", rows: gateStatusHistory },
      { name: "merge_history", rows: mergeHistory },
      { name: "quarantine_log", rows: quarantineLog },
      { name: "refresh_log", rows: refreshLog },
    ],
    governance: [
      { name: "suppressions", rows: suppressions },
      { name: "tombstones", rows: tombstones },
      { name: "users", rows: users },
      { name: "role_permissions", rows: rolePermissions },
      { name: "audit_log", rows: auditLog },
      { name: "integration_contracts", rows: integrationContracts },
    ],
    seedTimestamp: latestClient?.createdAt ?? null,
  };
}

// ----------------------------------------------------------------------------
// Scenario checks — each returns an actual count vs an expectation, and a pass flag
// ----------------------------------------------------------------------------

type ScenarioResult = {
  name: string;
  expected: string;
  actual: number;
  pass: boolean;
};

// Canonicalises a LinkedIn URL so seeded variants (trailing slash, www., http vs https)
// collapse to the same key — the same transformation a real dedup module would apply.
function normaliseLinkedinUrl(url: string): string {
  return url.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
}

async function runScenarios(): Promise<ScenarioResult[]> {
  const [ctech, cfin] = await Promise.all([
    db.client.findFirst({ where: { name: "ClientCo Tech" }, select: { id: true } }),
    db.client.findFirst({ where: { name: "ClientCo Finance" }, select: { id: true } }),
  ]);

  // 1. Dedup-contact (ClientCo Tech): count canonicalised LinkedIn URLs that map to ≥ 2 persons.
  let dedupContact = 0;
  if (ctech) {
    const rows = await db.person.findMany({
      where: { clientId: ctech.id, linkedinUrl: { not: null } },
      select: { linkedinUrl: true },
    });
    const counts = new Map<string, number>();
    for (const r of rows) {
      if (!r.linkedinUrl) continue;
      const key = normaliseLinkedinUrl(r.linkedinUrl);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    dedupContact = [...counts.values()].filter((c) => c >= 2).length;
  }

  // 2. Dedup-company (ClientCo Finance): group by first token of legalName (lowercased);
  // count groups that span ≥ 2 distinct rootDomains.
  let dedupCompany = 0;
  if (cfin) {
    const rows = await db.company.findMany({
      where: { clientId: cfin.id },
      select: { legalName: true, rootDomain: true },
    });
    const groups = new Map<string, Set<string>>();
    for (const r of rows) {
      const root = (r.legalName.split(/\s+/)[0] ?? "").toLowerCase();
      if (!root) continue;
      if (!groups.has(root)) groups.set(root, new Set());
      groups.get(root)!.add(r.rootDomain);
    }
    dedupCompany = [...groups.values()].filter((s) => s.size >= 2).length;
  }

  // 3. Conflict-resolution: contactIds with EnrichmentLog rows from BOTH cognism and apollo.
  const enrichRows = await db.enrichmentLog.findMany({
    where: { contactId: { not: null }, provider: { in: ["cognism", "apollo"] } },
    select: { contactId: true, provider: true },
  });
  const providersByContact = new Map<string, Set<string>>();
  for (const row of enrichRows) {
    if (!row.contactId) continue;
    if (!providersByContact.has(row.contactId)) {
      providersByContact.set(row.contactId, new Set());
    }
    providersByContact.get(row.contactId)!.add(row.provider);
  }
  const conflictResolution = [...providersByContact.values()].filter(
    (s) => s.has("cognism") && s.has("apollo"),
  ).length;

  // 4. Quarantine
  const quarantine = await db.contact.count({ where: { quarantineReason: { not: null } } });

  // 5. Stale gate_2
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000);
  const stale = await db.contact.count({
    where: { gateStatus: "gate_2", lastVerifiedAt: { lt: ninetyDaysAgo } },
  });

  // 6. Invalid-email verifications
  const invalidEmail = await db.verification.count({ where: { status: "invalid" } });

  // 7. Tombstones
  const tombstones = await db.tombstone.count();

  // 8. Opt-out suppression
  const optOut = await db.suppression.count({ where: { isOptOut: true } });

  return [
    { name: "Dedup-contact (ClientCo Tech, canonical LinkedIn URLs)", expected: "≥ 5", actual: dedupContact, pass: dedupContact >= 5 },
    { name: "Dedup-company (ClientCo Finance, shared name root)", expected: "≥ 3", actual: dedupCompany, pass: dedupCompany >= 3 },
    { name: "Conflict-resolution (cognism × apollo on same contact)", expected: "≥ 4", actual: conflictResolution, pass: conflictResolution >= 4 },
    { name: "Quarantine reason set on Contact", expected: "= 8", actual: quarantine, pass: quarantine === 8 },
    { name: "Stale gate_2 (lastVerifiedAt > 90 days ago)", expected: "> 0", actual: stale, pass: stale > 0 },
    { name: "Invalid-email verifications", expected: "> 0", actual: invalidEmail, pass: invalidEmail > 0 },
    { name: "Tombstones", expected: "≥ 3", actual: tombstones, pass: tombstones >= 3 },
    { name: "Opt-out suppression (isOptOut = true)", expected: "≥ 1", actual: optOut, pass: optOut >= 1 },
  ];
}

// ----------------------------------------------------------------------------
// Presentation
// ----------------------------------------------------------------------------

function CountTable({ title, rows }: { title: string; rows: { name: string; rows: number }[] }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">{title}</h2>
      <table className="mt-2 w-full border text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="border px-3 py-2 text-left">Table</th>
            <th className="border px-3 py-2 text-right">Rows</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td className="border px-3 py-2 font-mono">{r.name}</td>
              <td className="border px-3 py-2 text-right font-mono">{r.rows.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function StatusBadge({ pass }: { pass: boolean }) {
  const cls = pass
    ? "bg-green-100 text-green-800"
    : "bg-red-100 text-red-800";
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${cls}`}>
      {pass ? "PASS" : "FAIL"}
    </span>
  );
}

export default async function HealthPage() {
  const counts = await loadCounts();
  const scenarios = await runScenarios();
  const allGreen = scenarios.every((s) => s.pass);

  return (
    <main className="min-h-screen max-w-5xl mx-auto p-8">
      <h1 className="text-2xl font-semibold">Database Health</h1>
      <p className="mt-1 text-sm text-gray-600">
        Latest seed timestamp:{" "}
        <span className="font-mono">
          {counts.seedTimestamp ? counts.seedTimestamp.toISOString() : "—"}
        </span>
      </p>
      <p className="mt-1 text-sm">
        Overall:{" "}
        <StatusBadge pass={allGreen} />{" "}
        <span className="text-gray-600">
          ({scenarios.filter((s) => s.pass).length}/{scenarios.length} scenario checks passing)
        </span>
      </p>

      <CountTable title="Identity layer" rows={counts.identity} />
      <CountTable title="Event-log layer" rows={counts.eventLog} />
      <CountTable title="Governance layer" rows={counts.governance} />

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Scenario checks</h2>
        <table className="mt-2 w-full border text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="border px-3 py-2 text-left">Check</th>
              <th className="border px-3 py-2 text-left">Expected</th>
              <th className="border px-3 py-2 text-right">Actual</th>
              <th className="border px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map((s) => (
              <tr key={s.name}>
                <td className="border px-3 py-2">{s.name}</td>
                <td className="border px-3 py-2 font-mono">{s.expected}</td>
                <td className="border px-3 py-2 text-right font-mono">{s.actual}</td>
                <td className="border px-3 py-2">
                  <StatusBadge pass={s.pass} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
