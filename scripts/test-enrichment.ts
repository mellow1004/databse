/**
 * End-to-end exercise of the enrichment service.
 *
 * The flow:
 *   1. Pre-compute which seeded contacts each mock provider would match
 *      (the mocks are pure functions, so we can predict outcomes before
 *      calling the service).
 *   2. Hand-pick three groups of three "both-match" contacts:
 *        - SE/GB/NO/DK/FI/DE  → Cognism is primary (delta ≥ 0.15, primary wins)
 *        - US/CA/MX           → Apollo is primary
 *        - FR/NL (or other)   → no primary-by-market, delta < 0.15 → conflict
 *      Plus padding contacts to hit total ≥ 15.
 *   3. Idempotent cleanup of prior test residue.
 *   4. Run enrichContactsBulk, then assert against:
 *        - bulk counters
 *        - enrichment_log row counts
 *        - "primary wins" — by re-running the pure providers in the test
 *          and comparing the contact's actual title against the predicted
 *          winner
 *        - conflict_pending rows exist
 *        - audit_log row, lastEnrichedAt, credit tally
 *   5. Manual-override path: short-lived override that proves no log rows
 *      are written. Override is reset afterwards.
 *
 * Run with: npm run test:enrichment
 */
import { db } from "../src/lib/db";
import { apollo, cognism } from "../src/providers";
import type { EnrichmentInput } from "../src/providers/types";
import {
  enrichContact,
  enrichContactsBulk,
} from "../src/services/enrichment";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, expected?: unknown, actual?: unknown) {
  if (cond) {
    console.log(`PASS  ${name}`);
    passed += 1;
  } else {
    console.log(`FAIL  ${name}`);
    if (expected !== undefined || actual !== undefined) {
      console.log(`      expected: ${JSON.stringify(expected)}`);
      console.log(`      actual:   ${JSON.stringify(actual)}`);
    }
    failed += 1;
  }
}

type ContactRow = {
  id: string;
  email: string | null;
  title: string | null;
  manualOverrideUntil: Date | null;
  personFullName: string;
  personLinkedinUrl: string | null;
  personPrimaryEmail: string | null;
  companyId: string;
  companyLegalName: string;
  companyRootDomain: string;
  companyCountry: string | null;
};

function buildInput(c: ContactRow): EnrichmentInput {
  return {
    fullName: c.personFullName,
    email: c.email ?? c.personPrimaryEmail ?? null,
    linkedinUrl: c.personLinkedinUrl ?? null,
    companyName: c.companyLegalName,
    domain: c.companyRootDomain,
    country: c.companyCountry,
  };
}

async function cleanupPriorAuditRows() {
  await db.auditLog.deleteMany({
    where: { action: "enrichment_batch_completed" },
  });
}

async function main() {
  console.log("Running enrichment service tests against dev.db ...\n");

  const [client, dataOwner] = await Promise.all([
    db.client.findFirst({ where: { name: "Brightvision Internal" } }),
    db.user.findFirst({ where: { role: "data_owner" } }),
  ]);
  if (!client || !dataOwner) {
    console.error("Seed prerequisites missing — run `npm run db:seed` first.");
    process.exit(1);
  }
  await cleanupPriorAuditRows();

  // ---- Load candidate contacts and pre-compute provider outcomes ----
  const raw = await db.contact.findMany({
    where: {
      clientId: client.id,
      mergedIntoId: null,
      person: { fullName: { not: "" } },
    },
    select: {
      id: true,
      email: true,
      title: true,
      manualOverrideUntil: true,
      person: { select: { fullName: true, linkedinUrl: true, primaryEmail: true } },
      company: {
        select: { id: true, legalName: true, rootDomain: true, country: true },
      },
    },
    take: 800,
  });
  const candidates: ContactRow[] = raw.map((r) => ({
    id: r.id,
    email: r.email,
    title: r.title,
    manualOverrideUntil: r.manualOverrideUntil,
    personFullName: r.person.fullName,
    personLinkedinUrl: r.person.linkedinUrl,
    personPrimaryEmail: r.person.primaryEmail,
    companyId: r.company.id,
    companyLegalName: r.company.legalName,
    companyRootDomain: r.company.rootDomain,
    companyCountry: r.company.country,
  }));

  // Bucket by country class.
  const COGNISM_MARKETS = new Set(cognism.primaryMarkets);
  const APOLLO_MARKETS = new Set(apollo.primaryMarkets);

  type Bucket = "cognism_primary" | "apollo_primary" | "neither_primary";
  function bucketOf(country: string | null): Bucket {
    if (country && APOLLO_MARKETS.has(country)) return "apollo_primary";
    if (country && COGNISM_MARKETS.has(country)) return "cognism_primary";
    return "neither_primary";
  }

  // Run pure providers against each candidate once to find guaranteed
  // "both-match" rows. Pure functions — no DB writes.
  type Predicted = ContactRow & {
    cognism: Awaited<ReturnType<typeof cognism.enrichContact>>;
    apollo: Awaited<ReturnType<typeof apollo.enrichContact>>;
    bucket: Bucket;
  };
  const predicted: Predicted[] = [];
  for (const c of candidates) {
    const input = buildInput(c);
    const [cogRes, aplRes] = await Promise.all([
      cognism.enrichContact(input),
      apollo.enrichContact(input),
    ]);
    predicted.push({ ...c, cognism: cogRes, apollo: aplRes, bucket: bucketOf(c.companyCountry) });
  }

  // Pick three from each bucket where BOTH providers match.
  const bothMatch = predicted.filter((p) => p.cognism.matched && p.apollo.matched);
  const cognismPrimaryBoth = bothMatch.filter((p) => p.bucket === "cognism_primary").slice(0, 3);
  const apolloPrimaryBoth = bothMatch.filter((p) => p.bucket === "apollo_primary").slice(0, 3);
  const neitherPrimaryBoth = bothMatch.filter((p) => p.bucket === "neither_primary").slice(0, 3);

  check(
    "Setup: ≥ 3 cognism-primary both-match candidates available",
    cognismPrimaryBoth.length >= 3,
    "≥ 3",
    cognismPrimaryBoth.length,
  );
  check(
    "Setup: ≥ 3 apollo-primary both-match candidates available",
    apolloPrimaryBoth.length >= 3,
    "≥ 3",
    apolloPrimaryBoth.length,
  );
  check(
    "Setup: ≥ 3 neither-primary both-match candidates (will produce conflict_pending)",
    neitherPrimaryBoth.length >= 3,
    "≥ 3",
    neitherPrimaryBoth.length,
  );

  // Padding rows from the candidate pool so total ≥ 15.
  const pickedIds = new Set([
    ...cognismPrimaryBoth.map((p) => p.id),
    ...apolloPrimaryBoth.map((p) => p.id),
    ...neitherPrimaryBoth.map((p) => p.id),
  ]);
  const padding = predicted.filter((p) => !pickedIds.has(p.id)).slice(0, 6);
  const picks: Predicted[] = [
    ...cognismPrimaryBoth,
    ...apolloPrimaryBoth,
    ...neitherPrimaryBoth,
    ...padding,
  ];
  const pickedIdsList = picks.map((p) => p.id);
  check(
    "Setup: 15 contact ids total (3+3+3+6 padding)",
    pickedIdsList.length === 15,
    15,
    pickedIdsList.length,
  );

  // Wipe any manualOverrideUntil that prior failed runs may have left on
  // these contacts.
  await db.contact.updateMany({
    where: { id: { in: pickedIdsList } },
    data: { manualOverrideUntil: null },
  });

  const enrichmentLogsBefore = await db.enrichmentLog.count();
  const auditBefore = await db.auditLog.count({
    where: { action: "enrichment_batch_completed" },
  });
  const tStart = new Date(Date.now() - 2000); // a tick before service call

  // ---- Bulk run ----
  console.log("\n--- Bulk enrichment run ---");
  const result = await enrichContactsBulk(pickedIdsList, {
    actorUserId: dataOwner.id,
  });

  check("bulk: total === 15", result.total === 15, 15, result.total);
  check(
    "bulk: enriched + noMatch + skipped + failed === total",
    result.enriched + result.noMatch + result.skipped + result.failed === result.total,
    result.total,
    result.enriched + result.noMatch + result.skipped + result.failed,
  );
  check("bulk: failed === 0", result.failed === 0, 0, result.failed);
  check("bulk: skipped === 0", result.skipped === 0, 0, result.skipped);
  check(
    "bulk: every outcome has 2 provider calls (cognism + apollo)",
    result.outcomes.every((o) => o.providerCalls.length === 2),
    "2 per outcome",
    result.outcomes.map((o) => o.providerCalls.length),
  );
  check(
    "bulk: creditsByProvider.cognism > 0",
    (result.creditsByProvider.cognism ?? 0) > 0,
    "> 0",
    result.creditsByProvider.cognism,
  );
  check(
    "bulk: creditsByProvider.apollo > 0",
    (result.creditsByProvider.apollo ?? 0) > 0,
    "> 0",
    result.creditsByProvider.apollo,
  );

  // ---- DB-level enrichment_log assertions ----
  const enrichmentLogsAfter = await db.enrichmentLog.count();
  check(
    "db: enrichment_log grew by ≥ 30 rows (2 per contact min)",
    enrichmentLogsAfter - enrichmentLogsBefore >= 30,
    "≥ 30",
    enrichmentLogsAfter - enrichmentLogsBefore,
  );

  const logsForBatch = await db.enrichmentLog.findMany({
    where: { batchId: result.batchId },
    select: {
      contactId: true,
      provider: true,
      step: true,
      status: true,
      fieldsFilled: true,
      creditsUsed: true,
    },
  });
  const logsByContact = new Map<string, typeof logsForBatch>();
  for (const r of logsForBatch) {
    if (r.contactId === null) continue;
    if (!logsByContact.has(r.contactId)) logsByContact.set(r.contactId, []);
    logsByContact.get(r.contactId)!.push(r);
  }
  check(
    "db: each contact has ≥ 2 enrichment_log rows (one per enricher)",
    pickedIdsList.every((id) => (logsByContact.get(id)?.length ?? 0) >= 2),
    "all ≥ 2",
    pickedIdsList.map((id) => ({ id, count: logsByContact.get(id)?.length ?? 0 })),
  );

  const conflictRows = logsForBatch.filter((r) => r.status === "conflict_pending");
  check(
    "db: ≥ 1 conflict_pending row exists (neither-primary both-match → delta < 0.15)",
    conflictRows.length >= 1,
    "≥ 1",
    conflictRows.length,
  );
  check(
    "result: conflictsFlagged matches conflict_pending log count",
    result.conflictsFlagged === conflictRows.length,
    conflictRows.length,
    result.conflictsFlagged,
  );

  // ---- Primary-wins assertions ----
  // After enrichment, re-fetch the contact's title and compare against the
  // predicted primary's title. Cognism and Apollo title pools are disjoint,
  // so equality alone proves provenance.
  const refreshedContacts = await db.contact.findMany({
    where: { id: { in: pickedIdsList } },
    select: { id: true, title: true, writeSource: true, lastEnrichedAt: true },
  });
  const refreshedById = new Map(refreshedContacts.map((c) => [c.id, c]));

  let cognismPrimaryWins = 0;
  for (const p of cognismPrimaryBoth) {
    const got = refreshedById.get(p.id);
    if (got?.title === p.cognism.fields.title) cognismPrimaryWins += 1;
  }
  check(
    "primary wins (cognism markets): all 3 SE/Nordic contacts now carry cognism's title",
    cognismPrimaryWins === cognismPrimaryBoth.length,
    cognismPrimaryBoth.length,
    cognismPrimaryWins,
  );

  let apolloPrimaryWins = 0;
  for (const p of apolloPrimaryBoth) {
    const got = refreshedById.get(p.id);
    if (got?.title === p.apollo.fields.title) apolloPrimaryWins += 1;
  }
  check(
    "primary wins (apollo markets): all 3 US contacts now carry apollo's title",
    apolloPrimaryWins === apolloPrimaryBoth.length,
    apolloPrimaryBoth.length,
    apolloPrimaryWins,
  );

  // For neither-primary contacts, title should be flagged as conflict_pending
  // and NOT updated.
  let neitherPrimaryUntouched = 0;
  for (const p of neitherPrimaryBoth) {
    const got = refreshedById.get(p.id);
    if (got?.title === p.title) neitherPrimaryUntouched += 1;
  }
  check(
    "conflict: neither-primary both-match contacts kept their original title (no auto-resolve)",
    neitherPrimaryUntouched === neitherPrimaryBoth.length,
    neitherPrimaryBoth.length,
    neitherPrimaryUntouched,
  );

  // ---- Freshness & writeSource ----
  const updatedFreshness = refreshedContacts.every(
    (c) => c.lastEnrichedAt !== null && c.lastEnrichedAt >= tStart,
  );
  check(
    "db: every picked contact's lastEnrichedAt was updated",
    updatedFreshness,
    "all updated",
    refreshedContacts.map((c) => ({ id: c.id, t: c.lastEnrichedAt })),
  );
  const writeSourceMatchesPrimary = picks.every((p) => {
    const got = refreshedById.get(p.id);
    const expectedPrimary = p.bucket === "apollo_primary" ? "apollo" : "cognism";
    return got?.writeSource === expectedPrimary;
  });
  check(
    "db: every contact's writeSource equals its primary-by-market provider",
    writeSourceMatchesPrimary,
    "primary per market",
    picks.map((p) => ({
      id: p.id,
      bucket: p.bucket,
      writeSource: refreshedById.get(p.id)?.writeSource,
    })),
  );

  // ---- Audit log ----
  const auditAfter = await db.auditLog.count({
    where: { action: "enrichment_batch_completed" },
  });
  check(
    "audit_log: exactly one new enrichment_batch_completed row",
    auditAfter - auditBefore === 1,
    1,
    auditAfter - auditBefore,
  );
  const auditRow = await db.auditLog.findFirst({
    where: { action: "enrichment_batch_completed", batchId: result.batchId },
    select: { resourceId: true, afterState: true },
  });
  check(
    "audit_log: resourceId matches batchId",
    auditRow?.resourceId === result.batchId,
    result.batchId,
    auditRow?.resourceId,
  );
  const afterStateParsed =
    auditRow?.afterState ? JSON.parse(auditRow.afterState) : null;
  check(
    "audit_log: afterState carries conflictsFlagged count",
    afterStateParsed !== null && afterStateParsed.conflictsFlagged === result.conflictsFlagged,
    result.conflictsFlagged,
    afterStateParsed?.conflictsFlagged,
  );

  // ---- Manual-override path ----
  console.log("\n--- Manual-override path ---");
  const overrideContactId = padding[0]?.id ?? pickedIdsList[0]!;
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await db.contact.update({
    where: { id: overrideContactId },
    data: { manualOverrideUntil: future },
  });
  const logsBeforeOverride = await db.enrichmentLog.count({
    where: { contactId: overrideContactId },
  });
  const overrideOutcome = await enrichContact(overrideContactId, {
    actorUserId: dataOwner.id,
  });
  check(
    "manual-override: outcome status === 'skipped_manual_override'",
    overrideOutcome.status === "skipped_manual_override",
    "skipped_manual_override",
    overrideOutcome.status,
  );
  check(
    "manual-override: provider calls is empty",
    overrideOutcome.providerCalls.length === 0,
    0,
    overrideOutcome.providerCalls.length,
  );
  const logsAfterOverride = await db.enrichmentLog.count({
    where: { contactId: overrideContactId },
  });
  check(
    "manual-override: no new enrichment_log rows for the skipped contact",
    logsAfterOverride === logsBeforeOverride,
    logsBeforeOverride,
    logsAfterOverride,
  );
  // Reset the override.
  await db.contact.update({
    where: { id: overrideContactId },
    data: { manualOverrideUntil: null },
  });

  // ---- Soft-archive guard ----
  console.log("\n--- Soft-archive edge case ---");
  const archiveContactId = padding[1]?.id ?? pickedIdsList[1]!;
  const survivorContactId = padding[2]?.id ?? pickedIdsList[2]!;
  await db.contact.update({
    where: { id: archiveContactId },
    data: { mergedIntoId: survivorContactId },
  });
  let threw = false;
  try {
    await enrichContact(archiveContactId, { actorUserId: dataOwner.id });
  } catch {
    threw = true;
  }
  check("enrichContact(soft-archived) throws", threw, "throws", { threw });
  await db.contact.update({
    where: { id: archiveContactId },
    data: { mergedIntoId: null },
  });

  // ---- Summary ----
  console.log("");
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log("Run credits by provider:", result.creditsByProvider);
  console.log(
    `Conflicts flagged: ${result.conflictsFlagged} (across ${neitherPrimaryBoth.length} expected neither-primary contacts × up to 6 enrichable fields)`,
  );
  if (failed > 0) process.exit(1);
}

main()
  .catch((err) => {
    console.error("Unexpected error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
