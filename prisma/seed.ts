import { PrismaClient, type Prisma } from "@prisma/client";
import { faker } from "@faker-js/faker";
import { createHash } from "node:crypto";
import { hashEmail, hashLinkedinUrl } from "@/lib/hashing";

const db = new PrismaClient();
faker.seed(20260512);

// ============================================================
// Helpers
// ============================================================

const sha256Hex = (s: string) =>
  createHash("sha256").update(s.toLowerCase().trim()).digest("hex");

const newId = () => faker.string.uuid();

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);
const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000);

function pickOne<T>(xs: readonly T[]): T {
  return xs[faker.number.int({ min: 0, max: xs.length - 1 })];
}

function pickWeighted<T>(items: ReadonlyArray<readonly [T, number]>): T {
  const total = items.reduce((acc, [, w]) => acc + w, 0);
  let r = faker.number.float({ min: 0, max: total });
  for (const [item, w] of items) {
    r -= w;
    if (r <= 0) return item;
  }
  return items[items.length - 1][0];
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

function marketFromCountry(country: string | null | undefined): string {
  if (!country) return "other";
  const normalized = country.toUpperCase();
  if (["UK", "GB", "SE", "NO", "DK", "FI", "DE"].includes(normalized)) return "uk_nordics";
  if (["US", "CA", "MX"].includes(normalized)) return "north_america";
  if (["FR", "NL", "BE", "LU"].includes(normalized)) return "benelux";
  return "other";
}

function shouldApproachRetentionReview(seedKey: string): boolean {
  const hashPrefix = sha256Hex(seedKey).slice(0, 8);
  const bucket = Number.parseInt(hashPrefix, 16) % 100;
  return bucket < 5;
}

function lifecycleStageFromSeed(seedKey: string): {
  lifecycleStage: "active" | "dormant" | "frozen";
  lastCampaignAt: Date | null;
} {
  const hashPrefix = sha256Hex(seedKey).slice(0, 8);
  const bucket = Number.parseInt(hashPrefix, 16) % 100;
  if (bucket < 10) {
    return { lifecycleStage: "dormant", lastCampaignAt: daysAgo(120) };
  }
  if (bucket < 15) {
    return { lifecycleStage: "frozen", lastCampaignAt: daysAgo(250) };
  }
  return { lifecycleStage: "active", lastCampaignAt: null };
}

// ============================================================
// Constants
// ============================================================

const CLIENT_NAMES = [
  "Brightvision Internal",
  "ClientCo Tech",
  "ClientCo Finance",
] as const;

const TITLES_BY_SENIORITY: Record<string, readonly string[]> = {
  c_level: ["CEO", "CTO", "CRO", "CMO", "CFO", "COO", "Founder", "Co-Founder"],
  vp: ["VP Sales", "VP Marketing", "VP Engineering", "VP Product", "VP Customer Success", "SVP Sales"],
  director: ["Director of Sales", "Director of Marketing", "Director of Engineering", "Director of Customer Success", "Director of Operations"],
  manager: ["Sales Manager", "Marketing Manager", "Engineering Manager", "Product Manager", "Customer Success Manager"],
  ic: ["Account Executive", "Software Engineer", "Marketing Specialist", "Sales Development Representative", "Customer Success Associate", "Product Designer"],
  other: ["Consultant", "Advisor", "Freelancer"],
};

const INDUSTRIES = ["software", "fintech", "healthtech", "manufacturing", "retail", "energy", "biotech", "logistics", "edtech", "media"] as const;
const COUNTRIES = ["SE", "GB", "US", "DE", "NO", "DK", "FI", "FR", "NL"] as const;
const HEADCOUNT_BANDS = ["1-10", "11-50", "51-200", "201-1000", "1000+"] as const;
const ALIAS_TYPES = ["regional", "legacy", "acquired_brand"] as const;

const COMPANIES_PER_CLIENT = 50;
const PERSONS_PER_CLIENT = 600;
const CONTACTS_PER_CLIENT = 660; // ~50% gate_0, ~30% gate_1, ~20% gate_2

// ============================================================
// Types
// ============================================================

type SeededClient = { id: string; name: string };
type SeededCompany = { id: string; clientId: string; rootDomain: string; legalName: string; country: string };
type SeededContactRef = { id: string; clientId: string; gateStatus: string };
type SeededUser = { id: string; email: string; role: string; clientId: string | null };

// Module-scoped counters guarantee uniqueness for fields with unique constraints
let linkedinSeq = 0;
let domainSeq = 0;

// ============================================================
// Wipe (reverse FK order)
// ============================================================

async function wipe() {
  console.log("• wiping existing data");
  // Staging layer (Phase 2): delete first; staging_records.batchId points at import_batches.
  // No Prisma relations are declared, but conceptual FK order still matters for clarity.
  await db.stagingRecord.deleteMany();
  await db.importBatch.deleteMany();

  // Break the Company self-FK before deleting
  await db.company.updateMany({ data: { parentCompanyId: null } });

  // Standalone tables (no FK declarations)
  await db.auditLog.deleteMany();
  await db.integrationContract.deleteMany();
  await db.rolePermission.deleteMany();
  await db.user.deleteMany();
  await db.tombstone.deleteMany();
  await db.suppression.deleteMany();
  await db.refreshLog.deleteMany();
  await db.quarantineLog.deleteMany();
  await db.accuracySample.deleteMany();
  await db.mergeHistory.deleteMany();
  await db.gateStatusHistory.deleteMany();
  await db.verification.deleteMany();
  await db.otto2CallbackQueue.deleteMany();
  await db.otto2Call.deleteMany();
  await db.enrichmentLog.deleteMany();

  // Identity layer (children → parents)
  await db.contactCompanyRelationship.deleteMany();
  await db.domainAlias.deleteMany();
  await db.contact.deleteMany();
  await db.company.deleteMany();
  await db.person.deleteMany();
  await db.client.deleteMany();
}

// ============================================================
// Clients
// ============================================================

async function seedClients(): Promise<SeededClient[]> {
  const rows = CLIENT_NAMES.map((name) => ({
    id: newId(),
    name,
    createdAt: daysAgo(faker.number.int({ min: 180, max: 365 })),
  }));
  await db.client.createMany({ data: rows });
  console.log(`  clients: ${rows.length}`);
  return rows.map(({ id, name }) => ({ id, name }));
}

// ============================================================
// Users
// ============================================================

async function seedUsers(clients: SeededClient[]): Promise<SeededUser[]> {
  const [bv, ctech, cfin] = clients;
  const defs = [
    { email: "data.owner@brightvision.com", fullName: "Olivia Lindberg", role: "data_owner", clientId: null, trainingDaysAgo: 45 },
    { email: "deputy.owner@brightvision.com", fullName: "Marcus Berg", role: "deputy_data_owner", clientId: null, trainingDaysAgo: 60 },
    { email: "gtme.ops@brightvision.com", fullName: "Sofia Andersson", role: "gtme_ops_manager", clientId: null, trainingDaysAgo: 30 },
    { email: "pm.brightvision@brightvision.com", fullName: "Jonas Holm", role: "project_manager", clientId: bv.id, trainingDaysAgo: 70 },
    { email: "pm.tech@clientco-tech.com", fullName: "Linnea Stahl", role: "project_manager", clientId: ctech.id, trainingDaysAgo: 55 },
    { email: "pm.finance@clientco-finance.com", fullName: "Alexander Holm", role: "project_manager", clientId: cfin.id, trainingDaysAgo: 40 },
    { email: "sdr@brightvision.com", fullName: "Klara Falk", role: "sdr", clientId: ctech.id, trainingDaysAgo: 20 },
    { email: "analyst@brightvision.com", fullName: "Mikael Ek", role: "analyst", clientId: cfin.id, trainingDaysAgo: 15 },
  ];
  const rows = defs.map((u) => ({
    id: newId(),
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    clientId: u.clientId,
    active: true,
    aiLiteracyTrainingCompletedAt: daysAgo(u.trainingDaysAgo),
    createdAt: daysAgo(180),
  }));
  await db.user.createMany({ data: rows });
  console.log(`  users: ${rows.length}`);
  return rows.map(({ id, email, role, clientId }) => ({ id, email, role, clientId }));
}

// ============================================================
// Role permissions (RBAC matrix)
// ============================================================

async function seedRolePermissions() {
  const rows: { role: string; resource: string; action: string; scope: string }[] = [];

  // Data Owner: full power on all key resources
  for (const r of ["contact", "company", "suppression", "audit_log", "enrichment", "merge", "quarantine", "dsar", "schema"]) {
    rows.push({ role: "data_owner", resource: r, action: "read", scope: "global" });
    rows.push({ role: "data_owner", resource: r, action: "write", scope: "global" });
  }
  rows.push({ role: "data_owner", resource: "enrichment", action: "approve_bulk", scope: "global" });
  rows.push({ role: "data_owner", resource: "quarantine", action: "release_quarantine", scope: "global" });
  rows.push({ role: "data_owner", resource: "merge", action: "rollback", scope: "global" });

  // Deputy Data Owner: reads cross-client, writes own client
  rows.push({ role: "deputy_data_owner", resource: "contact", action: "read", scope: "global" });
  rows.push({ role: "deputy_data_owner", resource: "contact", action: "write", scope: "own_client" });
  rows.push({ role: "deputy_data_owner", resource: "suppression", action: "write", scope: "own_client" });
  rows.push({ role: "deputy_data_owner", resource: "quarantine", action: "release_quarantine", scope: "own_client" });

  // GTME Ops Manager
  rows.push({ role: "gtme_ops_manager", resource: "contact", action: "read", scope: "cross_client" });
  rows.push({ role: "gtme_ops_manager", resource: "enrichment", action: "trigger_enrichment", scope: "cross_client" });
  rows.push({ role: "gtme_ops_manager", resource: "audit_log", action: "read", scope: "cross_client" });

  // Project Manager: own client only
  rows.push({ role: "project_manager", resource: "contact", action: "read", scope: "own_client" });
  rows.push({ role: "project_manager", resource: "contact", action: "write", scope: "own_client" });
  rows.push({ role: "project_manager", resource: "enrichment", action: "trigger_enrichment", scope: "own_client" });
  rows.push({ role: "project_manager", resource: "suppression", action: "write", scope: "own_client" });

  // SDR: read-only
  rows.push({ role: "sdr", resource: "contact", action: "read", scope: "own_client" });
  rows.push({ role: "sdr", resource: "company", action: "read", scope: "own_client" });

  // Analyst: read + export
  rows.push({ role: "analyst", resource: "contact", action: "read", scope: "own_client" });
  rows.push({ role: "analyst", resource: "contact", action: "export", scope: "own_client" });
  rows.push({ role: "analyst", resource: "audit_log", action: "read", scope: "own_client" });

  await db.rolePermission.createMany({
    data: rows.map((r) => ({ id: newId(), ...r })),
  });
  console.log(`  role_permissions: ${rows.length}`);
}

// ============================================================
// Integration contracts (provider register)
// ============================================================

async function seedIntegrationContracts() {
  const yearAgo = daysAgo(365);
  const defs = [
    { providerName: "millionverifier", providerType: "email_verification", contractVersion: "2025-01", scc: false, mech: "adequacy_decision", markets: ["SE", "DK", "NO", "FI", "DE"], dailyCreditBudget: 5000 },
    { providerName: "bouncer", providerType: "email_verification", contractVersion: "2024-09", scc: true, mech: "sccs", markets: ["GB", "DE", "FR"], dailyCreditBudget: 2000 },
    { providerName: "cognism", providerType: "enrichment", contractVersion: "2025-03", scc: true, mech: "sccs", markets: ["GB", "SE", "NO", "DK", "FI"], dailyCreditBudget: 1000 },
    { providerName: "apollo", providerType: "enrichment", contractVersion: "2025-02", scc: true, mech: "sccs", markets: ["US", "CA"], dailyCreditBudget: 1500 },
    { providerName: "clay", providerType: "enrichment", contractVersion: "2024-11", scc: true, mech: "sccs", markets: ["US", "GB"], dailyCreditBudget: 800 },
    { providerName: "cognism_diamond", providerType: "phone_verification", contractVersion: "2025-03", scc: true, mech: "sccs", markets: ["GB", "SE", "NO", "DK"], dailyCreditBudget: 300 },
    { providerName: "otto2", providerType: "calling_platform", contractVersion: "2026-01", scc: true, mech: "sccs", markets: ["SE", "NO", "DK", "FI"], dailyCreditBudget: null as number | null },
  ];
  const rows = defs.map((c) => ({
    id: newId(),
    providerName: c.providerName,
    providerType: c.providerType,
    contractVersion: c.contractVersion,
    dataProcessingAgreementSigned: true,
    sccsInPlace: c.scc,
    transferMechanism: c.mech,
    transferImpactAssessmentRef: `tia-${c.providerName}-${c.contractVersion}`,
    subProcessorRegisterUpdated: daysAgo(faker.number.int({ min: 30, max: 180 })),
    status: "active",
    rateLimitConfig: JSON.stringify({
      requestsPerMinute: 60,
      requestsPerDay: c.dailyCreditBudget != null ? c.dailyCreditBudget * 10 : null,
    }),
    dailyCreditBudget: c.dailyCreditBudget ?? undefined,
    primaryMarkets: JSON.stringify(c.markets),
    effectiveFrom: yearAgo,
    effectiveUntil: null,
  }));
  await db.integrationContract.createMany({ data: rows });
  console.log(`  integration_contracts: ${rows.length}`);
}

// ============================================================
// Companies & domain aliases (per client)
// ============================================================

function makeDomain(legalName: string): string {
  domainSeq += 1;
  const base = legalName.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 14) || "co";
  return `${base}${domainSeq}.com`;
}

async function seedCompaniesAndDomains(client: SeededClient) {
  const companies: SeededCompany[] = [];
  for (let i = 0; i < COMPANIES_PER_CLIENT; i++) {
    const legalName = faker.company.name();
    const country = pickOne(COUNTRIES);
    companies.push({
      id: newId(),
      clientId: client.id,
      rootDomain: makeDomain(legalName),
      legalName,
      country,
    });
  }

  // Insert companies (parents null first)
  await db.company.createMany({
    data: companies.map((c) => ({
      id: c.id,
      clientId: c.clientId,
      rootDomain: c.rootDomain,
      legalName: c.legalName,
      parentCompanyId: null,
      industry: pickOne(INDUSTRIES),
      country: c.country,
      headcountBand: pickOne(HEADCOUNT_BANDS),
      createdAt: daysAgo(faker.number.int({ min: 60, max: 300 })),
    })),
  });

  // ~10% subsidiary hierarchies — set parentCompanyId for a few companies
  const subCount = Math.floor(companies.length * 0.1);
  for (let i = 0; i < subCount; i++) {
    const childIdx = faker.number.int({ min: 0, max: companies.length - 1 });
    let parentIdx = faker.number.int({ min: 0, max: companies.length - 1 });
    if (childIdx === parentIdx) parentIdx = (parentIdx + 1) % companies.length;
    await db.company.update({
      where: { id: companies[childIdx].id },
      data: { parentCompanyId: companies[parentIdx].id },
    });
  }

  // Domain aliases — ~20% of companies have one alias
  const aliasCount = Math.floor(companies.length * 0.2);
  const aliasRows: {
    id: string; clientId: string; companyId: string; aliasDomain: string; aliasType: string; createdAt: Date;
  }[] = [];
  const usedAliasDomains = new Set<string>();
  for (let i = 0; i < aliasCount; i++) {
    const c = companies[faker.number.int({ min: 0, max: companies.length - 1 })];
    const region = pickOne(["uk", "de", "us", "eu", "global", "legacy"] as const);
    const aliasDomain = `${c.rootDomain.split(".")[0]}-${region}-${i}.com`;
    if (usedAliasDomains.has(aliasDomain)) continue;
    usedAliasDomains.add(aliasDomain);
    aliasRows.push({
      id: newId(),
      clientId: c.clientId,
      companyId: c.id,
      aliasDomain,
      aliasType: pickOne(ALIAS_TYPES),
      createdAt: daysAgo(faker.number.int({ min: 30, max: 180 })),
    });
  }
  if (aliasRows.length) await db.domainAlias.createMany({ data: aliasRows });

  console.log(`  [${client.name}] companies: ${companies.length}, domain_aliases: ${aliasRows.length}`);
  return { companies, aliasCount: aliasRows.length };
}

// ============================================================
// Persons & contacts (per client)
// ============================================================

function makeLinkedinUrl(firstName: string, lastName: string): string {
  linkedinSeq += 1;
  const slug = `${firstName}-${lastName}`.toLowerCase().replace(/[^a-z-]/g, "");
  return `https://www.linkedin.com/in/${slug}-${linkedinSeq}`;
}

type ContactInsert = Prisma.ContactCreateManyInput;

async function seedPersonsAndContacts(client: SeededClient, companies: SeededCompany[]) {
  // ---- Persons ----
  const persons: {
    id: string; clientId: string; linkedinUrl: string | null; primaryEmail: string | null; primaryPhone: string | null;
    fullName: string; firstName: string; lastName: string; inferredGender: string | null; createdAt: Date;
  }[] = [];
  for (let i = 0; i < PERSONS_PER_CLIENT; i++) {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const fullName = `${firstName} ${lastName}`;
    const r = faker.number.float({ min: 0, max: 1 });
    let linkedinUrl: string | null = null;
    let primaryEmail: string | null = null;
    let primaryPhone: string | null = null;
    if (r < 0.85) {
      linkedinUrl = makeLinkedinUrl(firstName, lastName);
      primaryEmail = faker.internet.email({ firstName, lastName }).toLowerCase();
      primaryPhone = faker.helpers.maybe(() => faker.phone.number(), { probability: 0.6 }) ?? null;
    } else if (r < 0.95) {
      primaryEmail = faker.internet.email({ firstName, lastName }).toLowerCase();
    } else {
      primaryPhone = faker.phone.number();
    }
    persons.push({
      id: newId(),
      clientId: client.id,
      linkedinUrl,
      primaryEmail,
      primaryPhone,
      fullName,
      firstName,
      lastName,
      inferredGender: faker.helpers.maybe(() => pickOne(["female", "male", "unknown"] as const), { probability: 0.5 }) ?? null,
      createdAt: daysAgo(faker.number.int({ min: 30, max: 300 })),
    });
  }
  for (const batch of chunk(persons, 200)) {
    await db.person.createMany({ data: batch });
  }

  // ---- Contacts ----
  type ContactRow = {
    id: string; clientId: string; personId: string; companyId: string;
    email: string | null; phone: string | null; title: string; seniority: string;
    gateStatus: string; campaignActive: boolean; quarantineReason: string | null; lifecycleStage: string;
    lastCampaignAt: Date | null; hardBounceCount30d: number;
    lawfulBasis: string; processingPurpose: string; liaStatus: string; liaCompletedAt: Date;
    sensitivityTier: string; market: string; retentionStatus: string; retentionReviewDueAt: Date | null;
    freshnessLabel: string | null; lastVerifiedAt: Date | null; lastEnrichedAt: Date | null; derivedFieldVersion: string | null;
    writeSource: string | null; writePriority: number | null; manualOverrideUntil: Date | null;
    createdAt: Date;
    _invalidEmail?: boolean;
  };

  const contacts: ContactRow[] = [];
  for (let i = 0; i < CONTACTS_PER_CLIENT; i++) {
    const person = persons[i % persons.length];
    const company = pickOne(companies);
    const seniority = pickWeighted([
      ["c_level", 3],
      ["vp", 7],
      ["director", 15],
      ["manager", 30],
      ["ic", 40],
      ["other", 5],
    ] as const);
    const title = pickOne(TITLES_BY_SENIORITY[seniority]);
    const market = marketFromCountry(company.country ?? null);
    const contactId = newId();
    const retentionReviewFlag = shouldApproachRetentionReview(`${client.id}:${contactId}`);
    const lifecycle = lifecycleStageFromSeed(`${client.id}:${contactId}:lifecycle`);

    // Gate distribution: ~50% gate_0, ~30% gate_1, ~20% gate_2
    const gateRoll = faker.number.float({ min: 0, max: 1 });
    let gateStatus: string;
    if (gateRoll < 0.5) gateStatus = "gate_0";
    else if (gateRoll < 0.8) gateStatus = "gate_1";
    else gateStatus = "gate_2";

    // Email: 70% derived from name + company domain, 30% use the person's own email
    let email: string | null = null;
    if (person.primaryEmail) {
      email = faker.number.float({ min: 0, max: 1 }) < 0.7
        ? `${person.firstName.toLowerCase()}.${person.lastName.toLowerCase()}@${company.rootDomain}`
        : person.primaryEmail;
    }

    contacts.push({
      id: contactId,
      clientId: client.id,
      personId: person.id,
      companyId: company.id,
      email,
      phone: faker.helpers.maybe(() => faker.phone.number(), { probability: 0.4 }) ?? null,
      title,
      seniority,
      gateStatus,
      campaignActive: faker.number.float({ min: 0, max: 1 }) < 0.05,
      quarantineReason: null,
      lifecycleStage: lifecycle.lifecycleStage,
      lastCampaignAt: lifecycle.lastCampaignAt,
      hardBounceCount30d: 0,
      lawfulBasis: "legitimate_interest",
      processingPurpose: "b2b_prospecting",
      liaStatus: "documented",
      liaCompletedAt: daysAgo(60),
      sensitivityTier: "business_contact",
      market,
      retentionStatus: retentionReviewFlag ? "approaching_review" : "active",
      retentionReviewDueAt: retentionReviewFlag ? daysFromNow(30) : null,
      freshnessLabel: gateStatus === "gate_2" ? pickOne(["fresh", "aging", "stale"] as const) : null,
      lastVerifiedAt: gateStatus === "gate_0" ? null : daysAgo(faker.number.int({ min: 1, max: 80 })),
      lastEnrichedAt: gateStatus === "gate_0" ? null : daysAgo(faker.number.int({ min: 1, max: 80 })),
      derivedFieldVersion: gateStatus === "gate_0" ? null : "v1.0",
      writeSource: gateStatus === "gate_0"
        ? "manual_import"
        : pickOne(["cognism", "apollo", "clay", "manual_import"] as const),
      writePriority: gateStatus === "gate_0" ? 0 : faker.number.int({ min: 1, max: 5 }),
      manualOverrideUntil: null,
      createdAt: daysAgo(faker.number.int({ min: 30, max: 300 })),
    });
  }

  // ---- Scenario overlays (applied before insert) ----

  // Invalid-email scenario: ~3% of contacts get visibly invalid emails
  const invalidTargets = Math.floor(contacts.length * 0.03);
  const invalidPicked = new Set<number>();
  for (let i = 0; i < invalidTargets; i++) {
    let idx = faker.number.int({ min: 0, max: contacts.length - 1 });
    while (invalidPicked.has(idx)) idx = (idx + 1) % contacts.length;
    invalidPicked.add(idx);
    contacts[idx].email = pickOne([
      "noreply@example.invalid",
      "bounced@nonexistent.xyz",
      `not-an-email-${i}`,
      `${faker.string.alpha(8)}@disposable.${pickOne(["xyz", "invalid", "test"] as const)}`,
    ] as const);
    contacts[idx]._invalidEmail = true;
  }

  // Stale scenario: ~10% of gate_2 contacts get lastVerifiedAt ~120 days ago
  const gate2Indices = contacts
    .map((c, i) => (c.gateStatus === "gate_2" ? i : -1))
    .filter((i) => i >= 0);
  const staleCount = Math.floor(gate2Indices.length * 0.1);
  for (let i = 0; i < staleCount; i++) {
    const idx = gate2Indices[i];
    contacts[idx].lastVerifiedAt = daysAgo(120);
    contacts[idx].freshnessLabel = "stale";
  }

  // Gate_3 demo: 2 contacts explicitly at gate_3 (only in ClientCo Tech)
  if (client.name === "ClientCo Tech" && contacts.length >= 2) {
    contacts[0].gateStatus = "gate_3";
    contacts[1].gateStatus = "gate_3";
  }

  // Insert contacts (without the temp marker)
  for (const batch of chunk(contacts, 200)) {
    const data = batch.map((c) => {
      const { _invalidEmail: _ignored, ...rest } = c;
      void _ignored;
      return rest;
    });
    await db.contact.createMany({ data });
  }

  // ---- Pre-seeded verifications ----
  // gate_1, gate_2, gate_3 contacts get one valid verification (within last 60 days).
  // Invalid-email contacts (regardless of gate) get an invalid verification.
  const verRows: {
    id: string; clientId: string; contactId: string; verificationType: string; provider: string;
    status: string; confidence: number; rawResponse: string | null; batchId: string; createdAt: Date;
  }[] = [];
  const batchId = `batch-${client.name.replace(/\s/g, "").toLowerCase()}-init`;
  for (const c of contacts) {
    if (c._invalidEmail) {
      verRows.push({
        id: newId(),
        clientId: client.id,
        contactId: c.id,
        verificationType: "email",
        provider: "millionverifier",
        status: "invalid",
        confidence: 0.05,
        rawResponse: null,
        batchId,
        createdAt: daysAgo(faker.number.int({ min: 1, max: 60 })),
      });
    } else if (c.gateStatus !== "gate_0") {
      verRows.push({
        id: newId(),
        clientId: client.id,
        contactId: c.id,
        verificationType: "email",
        provider: "millionverifier",
        status: "valid",
        confidence: faker.number.float({ min: 0.85, max: 0.99, fractionDigits: 2 }),
        rawResponse: null,
        batchId,
        createdAt: daysAgo(faker.number.int({ min: 1, max: 60 })),
      });
    }
  }
  for (const b of chunk(verRows, 300)) {
    await db.verification.createMany({ data: b });
  }

  console.log(`  [${client.name}] persons: ${persons.length}, contacts: ${contacts.length}, verifications: ${verRows.length}`);
  return {
    persons: persons.length,
    contacts: contacts.length,
    verifications: verRows.length,
    contactRefs: contacts.map((c) => ({ id: c.id, clientId: client.id, gateStatus: c.gateStatus })) as SeededContactRef[],
  };
}

// ============================================================
// Contact ↔ Company relationships (M2M extras)
// ============================================================

async function seedContactCompanyRelationships(
  clients: SeededClient[],
  companiesByClient: Map<string, SeededCompany[]>,
  contactsByClient: Map<string, SeededContactRef[]>,
) {
  const TARGET = 50;
  const rows: {
    id: string; clientId: string; contactId: string; companyId: string;
    roleType: string; startDate: Date; endDate: Date | null; createdAt: Date;
  }[] = [];
  for (let i = 0; i < TARGET; i++) {
    const client = pickOne(clients);
    const ctcs = contactsByClient.get(client.id) ?? [];
    const cos = companiesByClient.get(client.id) ?? [];
    if (ctcs.length === 0 || cos.length < 2) continue;
    const c = pickOne(ctcs);
    const co = pickOne(cos);
    const roleType = pickWeighted([
      ["advisor", 40],
      ["board_member", 20],
      ["former_employee", 40],
    ] as const);
    const startDate = daysAgo(faker.number.int({ min: 60, max: 1200 }));
    const endDate = roleType === "former_employee"
      ? daysAgo(faker.number.int({ min: 30, max: 200 }))
      : null;
    rows.push({
      id: newId(),
      clientId: client.id,
      contactId: c.id,
      companyId: co.id,
      roleType,
      startDate,
      endDate,
      createdAt: daysAgo(faker.number.int({ min: 30, max: 200 })),
    });
  }
  if (rows.length) await db.contactCompanyRelationship.createMany({ data: rows });
  console.log(`  contact_company_relationships: ${rows.length}`);
  return rows.length;
}

// ============================================================
// Scenarios (dedup, conflict, quarantine)
// ============================================================

async function seedScenarios(
  clients: SeededClient[],
  companiesByClient: Map<string, SeededCompany[]>,
  contactsByClient: Map<string, SeededContactRef[]>,
) {
  const ctech = clients.find((c) => c.name === "ClientCo Tech")!;
  const cfin = clients.find((c) => c.name === "ClientCo Finance")!;

  let extraContacts = 0;
  let extraCompanies = 0;
  let enrichmentLogs = 0;
  let quarantined = 0;

  // --- 1. Dedup-contact scenario (ClientCo Tech): 5 pairs ---
  const dupNames: [string, string][] = [
    ["Anna", "Larsson"],
    ["Erik", "Nilsson"],
    ["Maria", "Johansson"],
    ["Lars", "Andersson"],
    ["Karin", "Eriksson"],
  ];
  const ctechCos = companiesByClient.get(ctech.id)!;
  for (let p = 0; p < dupNames.length; p++) {
    const [first, last] = dupNames[p];
    const company = ctechCos[p];
    const slug = `${first}-${last}`.toLowerCase();
    // Two Person rows with variant LinkedIn URLs (canonicalisation target)
    const personA = {
      id: newId(),
      clientId: ctech.id,
      linkedinUrl: `https://linkedin.com/in/${slug}`,
      primaryEmail: `${first}.${last}@acme.com`,
      primaryPhone: faker.phone.number(),
      fullName: `${first} ${last}`,
      firstName: first,
      lastName: last,
      inferredGender: null as string | null,
      createdAt: daysAgo(120),
    };
    const personB = {
      id: newId(),
      clientId: ctech.id,
      linkedinUrl: `https://www.linkedin.com/in/${slug}/`,
      primaryEmail: `${first.toLowerCase()}.${last.toLowerCase()}@acme.com`,
      primaryPhone: faker.phone.number(),
      fullName: `${first} ${last}`,
      firstName: first,
      lastName: last,
      inferredGender: null as string | null,
      createdAt: daysAgo(45),
    };
    await db.person.createMany({ data: [personA, personB] });

    // Two Contact rows pointing to the two persons — second has newer lastEnrichedAt (survivor)
    const baseContact = {
      clientId: ctech.id,
      companyId: company.id,
      title: "Director of Sales",
      seniority: "director",
      gateStatus: "gate_2",
      campaignActive: false,
      quarantineReason: null as string | null,
      lifecycleStage: "active",
      lawfulBasis: "legitimate_interest",
      processingPurpose: "b2b_prospecting",
      liaStatus: "documented",
      liaCompletedAt: daysAgo(60),
      sensitivityTier: "business_contact",
      market: marketFromCountry(company.country),
      retentionStatus: "active",
      retentionReviewDueAt: null as Date | null,
      freshnessLabel: "fresh",
      derivedFieldVersion: "v1.0",
      manualOverrideUntil: null as Date | null,
    };
    const contactA = {
      ...baseContact,
      id: newId(),
      personId: personA.id,
      email: personA.primaryEmail,
      phone: personA.primaryPhone,
      lastVerifiedAt: daysAgo(40),
      lastEnrichedAt: daysAgo(80),
      writeSource: "cognism",
      writePriority: 3,
      createdAt: daysAgo(120),
    };
    const contactB = {
      ...baseContact,
      id: newId(),
      personId: personB.id,
      email: personB.primaryEmail,
      phone: personB.primaryPhone,
      lastVerifiedAt: daysAgo(10),
      lastEnrichedAt: daysAgo(5), // newer => obvious survivor
      writeSource: "apollo",
      writePriority: 2,
      createdAt: daysAgo(45),
    };
    await db.contact.createMany({ data: [contactA, contactB] });
    extraContacts += 2;
  }

  // --- 2. Dedup-company scenario (ClientCo Finance): 3 pairs ---
  const dupCompanyBases = ["Acme", "Globex", "Initech"];
  for (const base of dupCompanyBases) {
    const co1 = {
      id: newId(),
      clientId: cfin.id,
      rootDomain: `${base.toLowerCase()}.com`,
      legalName: `${base} Holdings`,
      parentCompanyId: null as string | null,
      industry: pickOne(INDUSTRIES),
      country: "GB",
      headcountBand: "201-1000",
      createdAt: daysAgo(150),
    };
    const co2 = {
      id: newId(),
      clientId: cfin.id,
      rootDomain: `${base.toLowerCase()}-finance.com`,
      legalName: `${base} Finance Ltd`,
      parentCompanyId: null as string | null,
      industry: pickOne(INDUSTRIES),
      country: "GB",
      headcountBand: "201-1000",
      createdAt: daysAgo(120),
    };
    await db.company.createMany({ data: [co1, co2] });
    extraCompanies += 2;
  }

  // --- 3. Conflict-resolution scenario: 4 contacts with 2 conflicting enrichment_log rows each ---
  const allContacts: SeededContactRef[] = [];
  for (const list of contactsByClient.values()) allContacts.push(...list);
  const conflictTargets = faker.helpers.arrayElements(allContacts, 4);
  const conflictIds = new Set(conflictTargets.map((c) => c.id));
  const conflictRows: {
    id: string; clientId: string; contactId: string | null; companyId: string | null; batchId: string;
    provider: string; step: number; fieldsFilled: string; confidence: number; rawResponse: string | null;
    status: string; errorMessage: string | null; creditsUsed: number; createdAt: Date;
  }[] = [];
  for (const c of conflictTargets) {
    const batchId = `enrich-conflict-${c.id.slice(0, 8)}`;
    conflictRows.push({
      id: newId(),
      clientId: c.clientId,
      contactId: c.id,
      companyId: null,
      batchId,
      provider: "cognism",
      step: 1,
      fieldsFilled: JSON.stringify(["title", "seniority"]),
      confidence: 0.92,
      rawResponse: JSON.stringify({ title: "VP Sales", seniority: "vp" }),
      status: "success",
      errorMessage: null,
      creditsUsed: 1,
      createdAt: daysAgo(8),
    });
    conflictRows.push({
      id: newId(),
      clientId: c.clientId,
      contactId: c.id,
      companyId: null,
      batchId,
      provider: "apollo",
      step: 2,
      fieldsFilled: JSON.stringify(["title", "seniority"]),
      confidence: 0.87,
      rawResponse: JSON.stringify({ title: "Director of Sales", seniority: "director" }),
      status: "success",
      errorMessage: null,
      creditsUsed: 1,
      createdAt: daysAgo(7),
    });
  }
  if (conflictRows.length) await db.enrichmentLog.createMany({ data: conflictRows });
  enrichmentLogs += conflictRows.length;

  // --- 3b. Gate-2 enrichment stubs for accuracy QA sampling (per client, capped) ---
  const gate2ForAccuracy = await db.contact.findMany({
    where: {
      gateStatus: "gate_2",
      mergedIntoId: null,
      id: { notIn: [...conflictIds] },
    },
    select: { id: true, clientId: true, companyId: true },
  });
  const perClientCap = 40;
  const byClient = new Map<string, { id: string; clientId: string; companyId: string }[]>();
  for (const row of gate2ForAccuracy) {
    const arr = byClient.get(row.clientId) ?? [];
    if (arr.length < perClientCap) {
      arr.push(row);
      byClient.set(row.clientId, arr);
    }
  }
  const accuracyTargets = [...byClient.values()].flat();
  const accuracyRows: {
    id: string;
    clientId: string;
    contactId: string | null;
    companyId: string | null;
    batchId: string;
    provider: string;
    step: number;
    fieldsFilled: string;
    confidence: number;
    rawResponse: string | null;
    status: string;
    errorMessage: string | null;
    creditsUsed: number;
    createdAt: Date;
  }[] = [];
  for (const c of accuracyTargets) {
    const batchId = `seed-accuracy-${c.clientId.slice(0, 8)}`;
    const title = `QA seed title ${c.id.slice(0, 8)}`;
    const base = {
      clientId: c.clientId,
      contactId: c.id,
      companyId: c.companyId,
      batchId,
      fieldsFilled: JSON.stringify(["title"]),
      confidence: 0.9,
      rawResponse: JSON.stringify({
        fields: { title, seniority: "director" },
        matched: true,
        confidence: 0.9,
      }),
      status: "success",
      errorMessage: null,
      creditsUsed: 1,
      createdAt: daysAgo(3),
    };
    accuracyRows.push({
      id: newId(),
      ...base,
      provider: "cognism",
      step: 1,
    });
    accuracyRows.push({
      id: newId(),
      ...base,
      provider: "apollo",
      step: 2,
    });
  }
  if (accuracyRows.length) {
    await db.enrichmentLog.createMany({ data: accuracyRows });
    enrichmentLogs += accuracyRows.length;
  }

  // --- 4. Quarantine scenario: 8 contacts ---
  const quarantineMix: { count: number; reasonCode: string; reasonDetail: string }[] = [
    { count: 3, reasonCode: "bounce", reasonDetail: "Hard bounce on last campaign send" },
    { count: 3, reasonCode: "verification_failure", reasonDetail: "Email verification returned invalid" },
    { count: 2, reasonCode: "manual_flag", reasonDetail: "Flagged by Data Owner for review" },
  ];
  // Avoid colliding with conflict targets (so each contact tells one story)
  const eligible = allContacts.filter((c) => !conflictIds.has(c.id));
  const quarantineTargets = faker.helpers.arrayElements(eligible, 8);

  let qi = 0;
  const qlogRows: {
    id: string; clientId: string; contactId: string | null; companyId: string | null;
    reasonCode: string; reasonDetail: string | null; actor: string; reviewState: string;
    releasedAt: Date | null; releasedBy: string | null; releaseReason: string | null; createdAt: Date;
  }[] = [];
  for (const mix of quarantineMix) {
    for (let i = 0; i < mix.count; i++) {
      const target = quarantineTargets[qi];
      await db.contact.update({
        where: { id: target.id },
        data: {
          lifecycleStage: "frozen",
          quarantineReason: mix.reasonCode,
          campaignActive: false,
        },
      });
      qlogRows.push({
        id: newId(),
        clientId: target.clientId,
        contactId: target.id,
        companyId: null,
        reasonCode: mix.reasonCode,
        reasonDetail: mix.reasonDetail,
        actor: "system",
        reviewState: "pending",
        releasedAt: null,
        releasedBy: null,
        releaseReason: null,
        createdAt: daysAgo(faker.number.int({ min: 2, max: 30 })),
      });
      qi += 1;
      quarantined += 1;
    }
  }
  if (qlogRows.length) await db.quarantineLog.createMany({ data: qlogRows });

  console.log(
    `  scenarios: 5 dedup-contact pairs, 3 dedup-company pairs, ${conflictTargets.length} conflict targets, ${quarantined} quarantined`,
  );
  return { extraContacts, extraCompanies, enrichmentLogs, quarantined };
}

// ============================================================
// Suppressions & tombstones
// ============================================================

async function seedSuppressionsAndTombstones(clients: SeededClient[]) {
  const supRows: {
    id: string; scope: string; clientId: string | null; contactId: string | null; email: string | null; domain: string | null;
    reasonCode: string; reasonDetail: string | null; owner: string; source: string;
    isOptOut: boolean; coolingPeriodIndefinite: boolean; reviewRequiredBefore: Date | null;
    releaseStatus: string; releasedAt: Date | null; releasedBy: string | null; releaseReason: string | null;
    createdAt: Date; updatedAt: Date;
  }[] = [];

  // 3 global competitor blocks
  for (const dom of ["competitor1.com", "competitor2.com", "bigcorp-rival.com"]) {
    supRows.push({
      id: newId(),
      scope: "global",
      clientId: null,
      contactId: null,
      email: null,
      domain: dom,
      reasonCode: "competitor",
      reasonDetail: `Competitor block: ${dom}`,
      owner: "data_owner",
      source: "manual",
      isOptOut: false,
      coolingPeriodIndefinite: false,
      reviewRequiredBefore: null,
      releaseStatus: "active",
      releasedAt: null,
      releasedBy: null,
      releaseReason: null,
      createdAt: daysAgo(faker.number.int({ min: 30, max: 200 })),
      updatedAt: daysAgo(faker.number.int({ min: 1, max: 30 })),
    });
  }

  // 4 client-level suppressions
  const clientReasons = [
    { reasonCode: "legal_block", reasonDetail: "Legal hold during litigation" },
    { reasonCode: "conflict_of_interest", reasonDetail: "Existing customer of competing service" },
    { reasonCode: "stop_reply", reasonDetail: "Replied STOP to outreach" },
    { reasonCode: "bounce_repeated", reasonDetail: "3+ hard bounces in last 30 days" },
  ];
  for (let i = 0; i < clientReasons.length; i++) {
    const r = clientReasons[i];
    const c = clients[i % clients.length];
    supRows.push({
      id: newId(),
      scope: "client_level",
      clientId: c.id,
      contactId: null,
      email: faker.internet.email().toLowerCase(),
      domain: null,
      reasonCode: r.reasonCode,
      reasonDetail: r.reasonDetail,
      owner: "data_owner",
      source: r.reasonCode === "stop_reply" ? "ai_sdr_platform" : "manual",
      isOptOut: false,
      coolingPeriodIndefinite: false,
      reviewRequiredBefore: null,
      releaseStatus: "active",
      releasedAt: null,
      releasedBy: null,
      releaseReason: null,
      createdAt: daysAgo(faker.number.int({ min: 5, max: 90 })),
      updatedAt: daysAgo(faker.number.int({ min: 1, max: 5 })),
    });
  }

  // 3 domain-level suppressions (one per client)
  for (const c of clients) {
    supRows.push({
      id: newId(),
      scope: "domain_level",
      clientId: c.id,
      contactId: null,
      email: null,
      domain: `${c.name.toLowerCase().replace(/\s/g, "")}-blocked.com`,
      reasonCode: "legal_block",
      reasonDetail: "Client-specific domain block",
      owner: "data_owner",
      source: "manual",
      isOptOut: false,
      coolingPeriodIndefinite: false,
      reviewRequiredBefore: null,
      releaseStatus: "active",
      releasedAt: null,
      releasedBy: null,
      releaseReason: null,
      createdAt: daysAgo(faker.number.int({ min: 30, max: 90 })),
      updatedAt: daysAgo(faker.number.int({ min: 1, max: 10 })),
    });
  }

  // 1 explicit opt-out (regulatory, indefinite)
  supRows.push({
    id: newId(),
    scope: "global",
    clientId: null,
    contactId: null,
    email: "optout.example@personal.eu",
    domain: null,
    reasonCode: "opt_out",
    reasonDetail: "Direct opt-out request via webform",
    owner: "data_owner",
    source: "regulatory",
    isOptOut: true,
    coolingPeriodIndefinite: true,
    reviewRequiredBefore: null,
    releaseStatus: "active",
    releasedAt: null,
    releasedBy: null,
    releaseReason: null,
    createdAt: daysAgo(60),
    updatedAt: daysAgo(60),
  });

  await db.suppression.createMany({ data: supRows });

  // Tombstones — 3 pre-existing hashed identifiers.
  // Hashing goes through the same helpers intake uses, so the canonical form
  // (lowercase + trim for emails; strip protocol/www/trailing slash for
  // LinkedIn URLs) is what's stored. Anything else and a future intake run
  // wouldn't recognise the tombstoned identity.
  const tombDefs = [
    { hashType: "email_sha256", raw: "deleted.person@example.com", clientId: clients[0].id, deletionReason: "dsar_article_17", deletionActor: "data_owner" },
    { hashType: "linkedin_url_sha256", raw: "https://linkedin.com/in/removed-user", clientId: clients[1].id, deletionReason: "retention_lifecycle", deletionActor: "system" },
    { hashType: "email_sha256", raw: "erased@oldcompany.com", clientId: clients[2].id, deletionReason: "manual_owner_request", deletionActor: "data_owner" },
  ];
  const tombRows = tombDefs.map((t) => {
    const hashValue =
      t.hashType === "email_sha256"
        ? hashEmail(t.raw)
        : t.hashType === "linkedin_url_sha256"
          ? hashLinkedinUrl(t.raw)
          : null;
    if (!hashValue) {
      throw new Error(`Could not hash tombstone identifier: ${t.hashType} / ${t.raw}`);
    }
    return {
      id: newId(),
      hashType: t.hashType,
      hashValue,
      originalClientId: t.clientId,
      deletionReason: t.deletionReason,
      deletionActor: t.deletionActor,
      createdAt: daysAgo(faker.number.int({ min: 30, max: 200 })),
    };
  });
  await db.tombstone.createMany({ data: tombRows });

  // Demo tombstones — known plaintext used by samples/test_import.csv so the
  // demo walkthrough can deterministically trigger tombstone rejections.
  await db.tombstone.create({
    data: {
      hashType: "email_sha256",
      hashValue: hashEmail("deleted.john@example-demo.com")!,
      originalClientId: null,
      deletionReason: "dsar_article_17",
      deletionActor: "demo_seed",
    },
  });
  await db.tombstone.create({
    data: {
      hashType: "linkedin_url_sha256",
      hashValue: hashLinkedinUrl("https://www.linkedin.com/in/deleted-jane-demo/")!,
      originalClientId: null,
      deletionReason: "dsar_article_17",
      deletionActor: "demo_seed",
    },
  });
  const totalTombstones = tombRows.length + 2;

  console.log(`  suppressions: ${supRows.length}, tombstones: ${totalTombstones}`);
  return { suppressions: supRows.length, tombstones: totalTombstones };
}

// ============================================================
// Audit log
// ============================================================

async function seedAuditLog(clients: SeededClient[], users: SeededUser[]) {
  const dataOwner = users.find((u) => u.role === "data_owner")!;
  const gtmeOps = users.find((u) => u.role === "gtme_ops_manager")!;
  const pms = users.filter((u) => u.role === "project_manager");
  const sdr = users.find((u) => u.role === "sdr")!;
  const analyst = users.find((u) => u.role === "analyst")!;

  const actions: { action: string; resourceType: string; sensitivity: string; recordsAffected: number }[] = [
    { action: "enrichment_triggered", resourceType: "enrichment_batch", sensitivity: "business_contact", recordsAffected: 50 },
    { action: "enrichment_triggered", resourceType: "enrichment_batch", sensitivity: "business_contact", recordsAffected: 120 },
    { action: "gate_promoted", resourceType: "contact", sensitivity: "business_contact", recordsAffected: 1 },
    { action: "gate_promoted", resourceType: "contact", sensitivity: "business_contact", recordsAffected: 1 },
    { action: "gate_promoted", resourceType: "contact", sensitivity: "business_contact", recordsAffected: 1 },
    { action: "merge_executed", resourceType: "contact", sensitivity: "business_contact", recordsAffected: 2 },
    { action: "merge_executed", resourceType: "company", sensitivity: "public", recordsAffected: 2 },
    { action: "suppression_added", resourceType: "suppression", sensitivity: "business_contact", recordsAffected: 1 },
    { action: "suppression_added", resourceType: "suppression", sensitivity: "business_contact", recordsAffected: 1 },
    { action: "quarantine_released", resourceType: "quarantine", sensitivity: "business_contact", recordsAffected: 1 },
    { action: "dsar_received", resourceType: "dsar", sensitivity: "personal", recordsAffected: 1 },
    { action: "dsar_completed", resourceType: "dsar", sensitivity: "personal", recordsAffected: 1 },
    { action: "bulk_export", resourceType: "contact", sensitivity: "business_contact", recordsAffected: 500 },
    { action: "verification_batch_completed", resourceType: "enrichment_batch", sensitivity: "business_contact", recordsAffected: 200 },
    { action: "refresh_cycle_started", resourceType: "enrichment_batch", sensitivity: "business_contact", recordsAffected: 0 },
    { action: "refresh_cycle_completed", resourceType: "enrichment_batch", sensitivity: "business_contact", recordsAffected: 0 },
    { action: "schema_migration_applied", resourceType: "schema", sensitivity: "public", recordsAffected: 0 },
    { action: "rollback_executed", resourceType: "merge", sensitivity: "business_contact", recordsAffected: 5 },
    { action: "rbac_change", resourceType: "role_permission", sensitivity: "public", recordsAffected: 1 },
    { action: "integration_contract_renewed", resourceType: "integration_contract", sensitivity: "public", recordsAffected: 1 },
  ];

  const actorPool = [dataOwner, gtmeOps, ...pms, sdr, analyst];
  const rows = actions.map((a, i) => {
    const client = pickOne(clients);
    const actor = a.sensitivity === "personal"
      ? dataOwner
      : actorPool[i % actorPool.length];
    const isBulk = a.recordsAffected > 100;
    return {
      id: newId(),
      clientId: client.id,
      actorUserId: actor.id,
      actorRole: actor.role,
      action: a.action,
      resourceType: a.resourceType,
      resourceId: a.recordsAffected === 1 ? newId() : null,
      batchId: isBulk ? `batch-${i}-${a.action}` : null,
      recordsAffected: a.recordsAffected,
      approvalGranted: isBulk ? true : null,
      approverUserId: isBulk ? dataOwner.id : null,
      beforeState: null,
      afterState: null,
      sensitivityTier: a.sensitivity,
      ipAddress: faker.internet.ip(),
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) BVMDB/1.0",
      createdAt: daysAgo(faker.number.int({ min: 1, max: 60 })),
    };
  });

  await db.auditLog.createMany({ data: rows });
  console.log(`  audit_log: ${rows.length}`);
  return rows.length;
}

// ============================================================
// Otto 2 calling platform (historical calls + callback queue)
// ============================================================

async function seedOtto2(clients: SeededClient[], users: SeededUser[]) {
  const sdrUserId = users.find((u) => u.role === "data_owner")?.id ?? "system";
  const callRows: {
    id: string;
    contactId: string;
    clientId: string;
    sdrUserId: string;
    outcome: string;
    durationSec: number | null;
    notes: string | null;
    calledAt: Date;
  }[] = [];
  const callbackRows: {
    id: string;
    contactId: string;
    clientId: string;
    scheduledFor: Date;
    status: string;
    createdFromCallId: string | null;
    notes: string | null;
  }[] = [];
  const phoneVerRows: {
    id: string;
    clientId: string;
    contactId: string;
    verificationType: string;
    provider: string;
    status: string;
    confidence: number;
    rawResponse: string | null;
    batchId: string;
    createdAt: Date;
  }[] = [];
  const contactAttemptUpdates = new Map<string, number>();

  for (const client of clients) {
    const gate2WithPhone = await db.contact.findMany({
      where: {
        clientId: client.id,
        gateStatus: "gate_2",
        mergedIntoId: null,
        phone: { not: null },
      },
      select: { id: true, clientId: true, phone: true },
    });

    for (const contact of gate2WithPhone) {
      if (!contact.phone?.trim()) continue;
      const bucket = otto2DeterministicBucket(`${client.id}:${contact.id}:otto2-eligible`);
      if (bucket >= 5) continue;

      phoneVerRows.push({
        id: newId(),
        clientId: client.id,
        contactId: contact.id,
        verificationType: "phone",
        provider: "otto2",
        status: "valid",
        confidence: 0.92,
        rawResponse: null,
        batchId: `otto2-phone-${client.id.slice(0, 8)}`,
        createdAt: daysAgo(faker.number.int({ min: 5, max: 45 })),
      });

      const callCount = otto2DeterministicBucket(`${contact.id}:call-count`, 6);
      let lastCallId: string | null = null;
      for (let i = 0; i < callCount; i++) {
        const outcome =
          OTTO2_OUTCOMES[
            otto2DeterministicBucket(`${contact.id}:outcome:${i}`, OTTO2_OUTCOMES.length)
          ];
        const callId = newId();
        callRows.push({
          id: callId,
          contactId: contact.id,
          clientId: client.id,
          sdrUserId,
          outcome,
          durationSec: faker.number.int({ min: 15, max: 420 }),
          notes: faker.helpers.maybe(() => faker.lorem.sentence(), { probability: 0.3 }) ?? null,
          calledAt: daysAgo(faker.number.int({ min: 1, max: 90 }) + i),
        });
        lastCallId = callId;
      }
      contactAttemptUpdates.set(contact.id, callCount);

      const callbackBucket = otto2DeterministicBucket(`${contact.id}:callback-queue`);
      if (callbackBucket < 1 && lastCallId) {
        callbackRows.push({
          id: newId(),
          contactId: contact.id,
          clientId: client.id,
          scheduledFor: daysFromNow(faker.number.int({ min: 1, max: 7 })),
          status: "pending",
          createdFromCallId: lastCallId,
          notes: "Seed callback follow-up",
        });
      }
    }
  }

  if (callbackRows.length === 0 && callRows.length > 0) {
    const last = callRows[callRows.length - 1];
    callbackRows.push({
      id: newId(),
      contactId: last.contactId,
      clientId: last.clientId,
      scheduledFor: daysFromNow(3),
      status: "pending",
      createdFromCallId: last.id,
      notes: "Seed callback follow-up (deterministic demo)",
    });
  }

  for (const [contactId, attempts] of contactAttemptUpdates) {
    await db.contact.update({
      where: { id: contactId },
      data: { phoneVerified: true, totalCallAttempts: attempts },
    });
  }

  for (const batch of chunk(callRows, 300)) {
    await db.otto2Call.createMany({ data: batch });
  }
  for (const batch of chunk(callbackRows, 100)) {
    await db.otto2CallbackQueue.createMany({ data: batch });
  }
  for (const batch of chunk(phoneVerRows, 300)) {
    await db.verification.createMany({ data: batch });
  }

  console.log(
    `  otto2: ${contactAttemptUpdates.size} phone-verified prospects, ${callRows.length} calls, ${callbackRows.length} pending callbacks`,
  );
}

// ============================================================
// Main
// ============================================================

const PROVIDER_COUNT = 7;

const OTTO2_OUTCOMES = [
  "no_answer",
  "callback",
  "qualified_interview",
  "decline",
  "wrong_number",
  "answer_no_interview",
] as const;

function otto2DeterministicBucket(key: string, mod = 100): number {
  return Number.parseInt(sha256Hex(key).slice(0, 8), 16) % mod;
}

export type RunFullSeedResult = {
  clients: number;
  users: number;
  providers: number;
  companies: number;
  contacts: number;
  quarantined: number;
  suppressions: number;
  tombstones: number;
};

/** Disconnect the seed script's Prisma client (e.g. after API reset). */
export async function disconnectSeedDatabase(): Promise<void> {
  await db.$disconnect();
}

export async function runFullSeed(): Promise<RunFullSeedResult> {
  await wipe();

  const clients = await seedClients();
  const users = await seedUsers(clients);
  await seedRolePermissions();
  await seedIntegrationContracts();

  let companiesCount = 0;
  let aliasesCount = 0;
  let personsCount = 0;
  let contactsCount = 0;
  let verificationsCount = 0;

  const companiesByClient = new Map<string, SeededCompany[]>();
  const contactsByClient = new Map<string, SeededContactRef[]>();

  for (const c of clients) {
    const r = await seedCompaniesAndDomains(c);
    companiesByClient.set(c.id, r.companies);
    companiesCount += r.companies.length;
    aliasesCount += r.aliasCount;
  }

  for (const c of clients) {
    const r = await seedPersonsAndContacts(c, companiesByClient.get(c.id)!);
    contactsByClient.set(c.id, r.contactRefs);
    personsCount += r.persons;
    contactsCount += r.contacts;
    verificationsCount += r.verifications;
  }

  const ccrCount = await seedContactCompanyRelationships(
    clients,
    companiesByClient,
    contactsByClient,
  );
  const scenarioResult = await seedScenarios(clients, companiesByClient, contactsByClient);
  contactsCount += scenarioResult.extraContacts;
  companiesCount += scenarioResult.extraCompanies;

  const supTomb = await seedSuppressionsAndTombstones(clients);
  await seedOtto2(clients, users);
  const auditCount = await seedAuditLog(clients, users);

  console.log(
    `(also: ${aliasesCount} domain_aliases, ${personsCount} persons, ${ccrCount} contact_company_relationships, ${verificationsCount} verifications, ${scenarioResult.enrichmentLogs} enrichment_logs, ${auditCount} audit_log)`,
  );

  return {
    clients: clients.length,
    users: users.length,
    providers: PROVIDER_COUNT,
    companies: companiesCount,
    contacts: contactsCount,
    quarantined: scenarioResult.quarantined,
    suppressions: supTomb.suppressions,
    tombstones: supTomb.tombstones,
  };
}

async function main() {
  console.log("Brightvision Master Database — Seed");
  console.log("====================================");
  const summary = await runFullSeed();
  console.log("====================================");
  console.log(
    `Seed complete: ${summary.clients} clients, ${summary.users} users, ${summary.providers} providers, ${summary.companies} companies, ${summary.contacts} contacts, ${summary.quarantined} quarantined, ${summary.suppressions} suppressions, ${summary.tombstones} tombstones.`,
  );
}

function isDirectSeedCliRun(): boolean {
  const entry = process.argv[1]?.replace(/\\/g, "/") ?? "";
  return entry.endsWith("prisma/seed.ts");
}

if (isDirectSeedCliRun()) {
  main()
    .then(async () => {
      await db.$disconnect();
    })
    .catch(async (e) => {
      console.error(e);
      await db.$disconnect();
      process.exit(1);
    });
}
