/**
 * End-to-end exercise of the verification service against the live dev.db.
 *
 * The test:
 *   1. Resolves Brightvision Internal + the data_owner actor.
 *   2. Cleans up residue from previous test runs (synthetic test contacts +
 *      their staging records, persons, companies, verifications, audit
 *      rows) so the script is idempotent.
 *   3. Promotes a tiny synthetic ImportBatch to produce 2 writeSource=intake
 *      contacts.
 *   4. Picks 8 additional gate_1 / gate_2 contacts from the seed.
 *   5. Runs verifyContactsBulk + asserts every observable side effect.
 *   6. Re-runs the same ids to prove the table is append-only.
 *   7. Exercises the soft-archive guard.
 *
 * Run with:  npm run test:verification
 */
import { db } from "../src/lib/db";
import { promoteBatch } from "../src/services/promotion";
import {
  verifyContact,
  verifyContactsBulk,
} from "../src/services/verification";

// Stable markers so cleanup can find rows from prior runs.
const TEST_BATCH_PREFIX = "test-verification-";
const TEST_DOMAIN_A = "verify-test-a.test";
const TEST_DOMAIN_B = "verify-test-b.test";
const TEST_LINKEDIN_A = "linkedin.com/in/verify-test-person-a";
const TEST_LINKEDIN_B = "linkedin.com/in/verify-test-person-b";

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

async function cleanup() {
  // Find any prior synthetic contacts via the test linkedin URLs.
  const priorPersons = await db.person.findMany({
    where: { linkedinUrl: { in: [TEST_LINKEDIN_A, TEST_LINKEDIN_B] } },
    select: { id: true },
  });
  const priorPersonIds = priorPersons.map((p) => p.id);

  const priorContacts = await db.contact.findMany({
    where: { personId: { in: priorPersonIds } },
    select: { id: true },
  });
  const priorContactIds = priorContacts.map((c) => c.id);

  // Wipe in FK-safe order.
  if (priorContactIds.length) {
    await db.verification.deleteMany({ where: { contactId: { in: priorContactIds } } });
    await db.gateStatusHistory.deleteMany({ where: { contactId: { in: priorContactIds } } });
    await db.contactCompanyRelationship.deleteMany({
      where: { contactId: { in: priorContactIds } },
    });
    await db.contact.deleteMany({ where: { id: { in: priorContactIds } } });
  }
  if (priorPersonIds.length) {
    await db.person.deleteMany({ where: { id: { in: priorPersonIds } } });
  }

  const priorBatches = await db.importBatch.findMany({
    where: { fileName: { startsWith: TEST_BATCH_PREFIX } },
    select: { id: true },
  });
  const priorBatchIds = priorBatches.map((b) => b.id);
  if (priorBatchIds.length) {
    await db.stagingRecord.deleteMany({ where: { batchId: { in: priorBatchIds } } });
    await db.importBatch.deleteMany({ where: { id: { in: priorBatchIds } } });
    await db.auditLog.deleteMany({
      where: {
        OR: [
          { batchId: { in: priorBatchIds } },
          { resourceId: { in: priorBatchIds } },
        ],
      },
    });
  }
  // Test re-creates verification audit rows on every run; wipe prior to keep
  // the delta assertions deterministic.
  await db.auditLog.deleteMany({
    where: { action: "verification_batch_completed" },
  });
  await db.company.deleteMany({
    where: { rootDomain: { in: [TEST_DOMAIN_A, TEST_DOMAIN_B] } },
  });
}

async function ensureIntakeContacts(clientId: string, actorUserId: string): Promise<string[]> {
  // Create a synthetic import batch + 2 accepted staging records, then
  // promote it. The promotion service writes writeSource="intake" onto the
  // resulting Contact rows.
  const batch = await db.importBatch.create({
    data: {
      clientId,
      fileName: `${TEST_BATCH_PREFIX}${Date.now()}.csv`,
      fileSizeBytes: 256,
      source: "manual",
      uploadedBy: actorUserId,
      rowsTotal: 2,
      rowsAccepted: 2,
      status: "ready_for_review",
    },
  });

  await db.stagingRecord.createMany({
    data: [
      {
        clientId,
        batchId: batch.id,
        rowNumber: 1,
        rawValues: JSON.stringify({ email: "verify.test.a@verify-test-a.test" }),
        candidateEmail: "verify.test.a@verify-test-a.test",
        candidateLinkedinUrl: TEST_LINKEDIN_A,
        candidatePhone: "+46701234001",
        candidateFullName: "Verify Test Person A",
        candidateCompanyName: "Verify Test Company A",
        candidateDomain: TEST_DOMAIN_A,
        candidateTitle: "VP Sales",
        candidateCountry: "SE",
        status: "accepted",
      },
      {
        clientId,
        batchId: batch.id,
        rowNumber: 2,
        rawValues: JSON.stringify({ email: "verify.test.b@verify-test-b.test" }),
        candidateEmail: "verify.test.b@verify-test-b.test",
        candidateLinkedinUrl: TEST_LINKEDIN_B,
        candidatePhone: "+12025551234",
        candidateFullName: "Verify Test Person B",
        candidateCompanyName: "Verify Test Company B",
        candidateDomain: TEST_DOMAIN_B,
        candidateTitle: "Sales Director",
        candidateCountry: "US",
        status: "accepted",
      },
    ],
  });

  await promoteBatch({ batchId: batch.id, actorUserId });

  const promoted = await db.stagingRecord.findMany({
    where: { batchId: batch.id, status: "promoted" },
    select: { promotedContactId: true },
  });
  return promoted
    .map((r) => r.promotedContactId)
    .filter((id): id is string => id !== null);
}

async function main() {
  console.log("Running verification service tests against dev.db ...\n");

  const [client, dataOwner] = await Promise.all([
    db.client.findFirst({ where: { name: "Brightvision Internal" } }),
    db.user.findFirst({ where: { role: "data_owner" } }),
  ]);
  if (!client || !dataOwner) {
    console.error("Seed prerequisites missing — run `npm run db:seed` first.");
    process.exit(1);
  }

  await cleanup();

  // ---- Build the contact id pool ----
  const intakeContactIds = await ensureIntakeContacts(client.id, dataOwner.id);
  check(
    "Setup: 2 intake-promoted contacts created (writeSource=intake)",
    intakeContactIds.length === 2,
    2,
    intakeContactIds.length,
  );

  const seedContacts = await db.contact.findMany({
    where: {
      clientId: client.id,
      mergedIntoId: null,
      gateStatus: { in: ["gate_1", "gate_2"] },
      email: { not: null }, // assertions require an email per contact
      id: { notIn: intakeContactIds },
    },
    select: { id: true, gateStatus: true, phone: true },
    orderBy: { updatedAt: "asc" },
    take: 8,
  });
  const contactIds = [...intakeContactIds, ...seedContacts.map((c) => c.id)];
  check(
    "Setup: 10 total contact ids (2 intake + 8 seeded)",
    contactIds.length === 10,
    10,
    contactIds.length,
  );

  // Baselines for delta checks.
  const verificationsBefore = await db.verification.count();
  const auditBefore = await db.auditLog.count({
    where: { action: "verification_batch_completed" },
  });

  // ---- First bulk run ----
  console.log("\n--- Bulk run #1 ---");
  const result = await verifyContactsBulk(contactIds, {
    actorUserId: dataOwner.id,
    emailWaterfall: true,
  });

  check("bulk: total === 10", result.total === 10, 10, result.total);
  check("bulk: succeeded === 10", result.succeeded === 10, 10, result.succeeded);
  check("bulk: failed === 0", result.failed === 0, 0, result.failed);
  check(
    "bulk: every outcome has an emailVerification (all 10 picked contacts had an email)",
    result.outcomes.every((o) => o.emailVerification !== undefined),
    "all present",
    result.outcomes.map((o) => Boolean(o.emailVerification)),
  );
  check(
    "bulk: creditsByProvider.millionverifier > 0",
    (result.creditsByProvider.millionverifier ?? 0) > 0,
    "> 0",
    result.creditsByProvider.millionverifier,
  );

  const phoneOutcomes = result.outcomes.filter((o) => o.phoneVerification);
  check(
    "bulk: at least one phone verification ran",
    phoneOutcomes.length >= 1,
    "≥ 1",
    phoneOutcomes.length,
  );

  // ---- Verify DB side effects ----
  const verificationsAfter = await db.verification.count();
  const emailVerifsForBatch = await db.verification.count({
    where: { batchId: result.batchId, verificationType: "email" },
  });
  check(
    "db: verifications grew by ≥ 10 (one per contact, plus any fallback rows)",
    verificationsAfter - verificationsBefore >= 10,
    "≥ 10",
    verificationsAfter - verificationsBefore,
  );
  check(
    "db: ≥ 10 email-type verification rows tagged with the batch id",
    emailVerifsForBatch >= 10,
    "≥ 10",
    emailVerifsForBatch,
  );

  // lastVerifiedAt freshness — every picked contact must now be within the
  // last 60 seconds.
  const freshlyVerified = await db.contact.findMany({
    where: { id: { in: contactIds } },
    select: { id: true, lastVerifiedAt: true, writeSource: true, writePriority: true },
  });
  const tCutoff = new Date(Date.now() - 60_000);
  check(
    "db: every picked contact's lastVerifiedAt is within the last minute",
    freshlyVerified.every((c) => c.lastVerifiedAt !== null && c.lastVerifiedAt >= tCutoff),
    "all ≥ now-60s",
    freshlyVerified.map((c) => ({ id: c.id, t: c.lastVerifiedAt })),
  );
  check(
    "db: every picked contact's writeSource === 'verification'",
    freshlyVerified.every((c) => c.writeSource === "verification"),
    "all 'verification'",
    freshlyVerified.map((c) => c.writeSource),
  );
  check(
    "db: every picked contact's writePriority === 100",
    freshlyVerified.every((c) => c.writePriority === 100),
    100,
    freshlyVerified.map((c) => c.writePriority),
  );

  const auditAfter = await db.auditLog.count({
    where: { action: "verification_batch_completed" },
  });
  check(
    "audit_log: exactly one new verification_batch_completed row",
    auditAfter - auditBefore === 1,
    1,
    auditAfter - auditBefore,
  );

  const auditRow = await db.auditLog.findFirst({
    where: { action: "verification_batch_completed", batchId: result.batchId },
    select: { resourceId: true, recordsAffected: true, afterState: true },
  });
  check(
    "audit_log: batchId + recordsAffected match",
    auditRow !== null &&
      auditRow.resourceId === result.batchId &&
      auditRow.recordsAffected === 10,
    { resourceId: result.batchId, recordsAffected: 10 },
    auditRow,
  );

  // ---- Second bulk run on the same contacts (append-only check) ----
  console.log("\n--- Bulk run #2 (append-only proof) ---");
  const verificationsBeforeSecond = await db.verification.count();
  const result2 = await verifyContactsBulk(contactIds, {
    actorUserId: dataOwner.id,
    emailWaterfall: true,
  });
  check("bulk2: succeeded === 10", result2.succeeded === 10, 10, result2.succeeded);
  check(
    "bulk2: batchId differs from run #1",
    result2.batchId !== result.batchId,
    "different",
    { first: result.batchId, second: result2.batchId },
  );
  const verificationsAfterSecond = await db.verification.count();
  check(
    "bulk2: verifications row count grew again (append-only)",
    verificationsAfterSecond > verificationsBeforeSecond,
    `> ${verificationsBeforeSecond}`,
    verificationsAfterSecond,
  );

  // ---- Soft-archive guard ----
  console.log("\n--- Soft-archive edge case ---");
  const guinea = intakeContactIds[0]!;
  await db.contact.update({
    where: { id: guinea },
    data: { mergedIntoId: intakeContactIds[1]! },
  });
  let threw = false;
  let errMsg = "";
  try {
    await verifyContact(guinea, { actorUserId: dataOwner.id });
  } catch (err) {
    threw = true;
    errMsg = err instanceof Error ? err.message : String(err);
  }
  check(
    "verifyContact(soft-archived) throws",
    threw,
    "throws",
    { threw, errMsg },
  );
  check(
    "...with a mergedIntoId-related error message",
    /merged|archived/i.test(errMsg),
    "mentions merged/archived",
    errMsg,
  );
  // Revert.
  await db.contact.update({ where: { id: guinea }, data: { mergedIntoId: null } });

  // ---- Summary ----
  console.log("");
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`         Run #1 credits by provider:`, result.creditsByProvider);
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
