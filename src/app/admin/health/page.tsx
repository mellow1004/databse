import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/lib/db";
import { getStatusVariant } from "@/lib/badge-helpers";

export const dynamic = "force-dynamic";

async function loadCounts() {
  const [
    clients,
    persons,
    companies,
    domainAliases,
    contacts,
    ccRelationships,
    enrichmentLog,
    verifications,
    gateStatusHistory,
    mergeHistory,
    quarantineLog,
    refreshLog,
    suppressions,
    tombstones,
    users,
    rolePermissions,
    auditLog,
    integrationContracts,
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

type ScenarioResult = {
  name: string;
  expected: string;
  actual: number;
  pass: boolean;
};

function normaliseLinkedinUrl(url: string): string {
  return url
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
}

async function runScenarios(): Promise<ScenarioResult[]> {
  const [ctech, cfin] = await Promise.all([
    db.client.findFirst({ where: { name: "ClientCo Tech" }, select: { id: true } }),
    db.client.findFirst({ where: { name: "ClientCo Finance" }, select: { id: true } }),
  ]);

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

  const quarantine = await db.contact.count({ where: { quarantineReason: { not: null } } });

  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000);
  const stale = await db.contact.count({
    where: { gateStatus: "gate_2", lastVerifiedAt: { lt: ninetyDaysAgo } },
  });

  const invalidEmail = await db.verification.count({ where: { status: "invalid" } });

  const tombstones = await db.tombstone.count();

  const optOut = await db.suppression.count({ where: { isOptOut: true } });

  return [
    {
      name: "Dedup-contact (ClientCo Tech, canonical LinkedIn URLs)",
      expected: "≥ 5",
      actual: dedupContact,
      pass: dedupContact >= 5,
    },
    {
      name: "Dedup-company (ClientCo Finance, shared name root)",
      expected: "≥ 3",
      actual: dedupCompany,
      pass: dedupCompany >= 3,
    },
    {
      name: "Conflict-resolution (cognism × apollo on same contact)",
      expected: "≥ 4",
      actual: conflictResolution,
      pass: conflictResolution >= 4,
    },
    {
      name: "Quarantine reason set on Contact",
      expected: "= 8",
      actual: quarantine,
      pass: quarantine === 8,
    },
    {
      name: "Stale gate_2 (lastVerifiedAt > 90 days ago)",
      expected: "> 0",
      actual: stale,
      pass: stale > 0,
    },
    {
      name: "Invalid-email verifications",
      expected: "> 0",
      actual: invalidEmail,
      pass: invalidEmail > 0,
    },
    {
      name: "Tombstones (≥ 5 baseline — grows on hard delete)",
      expected: "≥ 5",
      actual: tombstones,
      pass: tombstones >= 5,
    },
    {
      name: "Opt-out suppression (isOptOut = true)",
      expected: "≥ 1",
      actual: optOut,
      pass: optOut >= 1,
    },
  ];
}

function LayerTable({ rows }: { rows: { name: string; rows: number }[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Table</TableHead>
          <TableHead className="text-right">Rows</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.name}>
            <TableCell className="font-mono text-sm">{r.name}</TableCell>
            <TableCell className="text-right font-mono text-sm tabular-nums">
              {r.rows.toLocaleString()}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default async function HealthPage() {
  const counts = await loadCounts();
  const scenarios = await runScenarios();
  const allGreen = scenarios.every((s) => s.pass);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Database health</h1>
        <p className="text-sm text-slate-600">
          Schema state, seeded data integrity, and scenario checks
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Badge
          className={getStatusVariant(allGreen ? "valid" : "failed")}
        >
          {allGreen ? "PASS" : "FAIL"}
        </Badge>
        <span className="text-sm text-slate-600">
          Seed timestamp:{" "}
          <span className="font-mono text-slate-800">
            {counts.seedTimestamp ? counts.seedTimestamp.toISOString() : "—"}
          </span>
        </span>
        <span className="text-sm text-slate-500">
          ({scenarios.filter((s) => s.pass).length}/{scenarios.length} checks passing)
        </span>
      </div>

      <Separator />

      <section className="space-y-2">
        <h2 className="text-xl font-semibold tracking-tight">Identity layer</h2>
        <p className="text-sm text-slate-600">Core identity and relationship tables.</p>
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Identity</CardTitle>
          </CardHeader>
          <CardContent>
            <LayerTable rows={counts.identity} />
          </CardContent>
        </Card>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold tracking-tight">Event-log layer</h2>
        <p className="text-sm text-slate-600">
          Verification, enrichment, gates, merges, and refresh cycles.
        </p>
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Event log</CardTitle>
          </CardHeader>
          <CardContent>
            <LayerTable rows={counts.eventLog} />
          </CardContent>
        </Card>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold tracking-tight">Governance layer</h2>
        <p className="text-sm text-slate-600">
          Suppressions, tombstones, users, permissions, audit trail, contracts.
        </p>
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Governance</CardTitle>
          </CardHeader>
          <CardContent>
            <LayerTable rows={counts.governance} />
          </CardContent>
        </Card>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold tracking-tight">Scenario checks</h2>
        <p className="text-sm text-slate-600">
          Seeded demo scenarios — failing rows indicate drift or a partial wipe.
        </p>
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Checks</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Check</TableHead>
                  <TableHead>Expected</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scenarios.map((s) => (
                  <TableRow key={s.name}>
                    <TableCell className="max-w-md text-sm">{s.name}</TableCell>
                    <TableCell className="font-mono text-sm">{s.expected}</TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">
                      {s.actual}
                    </TableCell>
                    <TableCell>
                      <Badge className={getStatusVariant(s.pass ? "valid" : "failed")}>
                        {s.pass ? "PASS" : "FAIL"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
