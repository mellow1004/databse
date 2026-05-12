/**
 * End-to-end exercise of the promotion service against the live dev.db.
 *
 * Creates a synthetic ImportBatch + 4 StagingRecord rows (directly via
 * Prisma so we don't depend on intake's parser), calls promoteBatch, then
 * verifies every counter in the output AND the persisted side effects
 * (staging rows flipped to promoted, contact gate transitions, history
 * rows, audit log entry).
 *
 * Idempotent: the cleanup() helper at the top wipes any residue from
 * previous runs (test contacts, test persons, test companies, prior test
 * batches and their staging rows + audit entries).
 *
 * Run with:  npm run test:promotion
 */
import { db } from "../src/lib/db";
import { promoteBatch } from "../src/services/promotion";

// ---- Deterministic test identifiers ----
const TEST_FILE_PREFIX = "test-promotion-";
const DOMAIN_A = "promo-test-a.test";
const DOMAIN_B = "promo-test-b.test";
const TEST_DOMAINS = [DOMAIN_A, DOMAIN_B];

const LI_A = "linkedin.com/in/promo-test-person-a";
const LI_B = "linkedin.com/in/promo-test-person-b";
const LI_C = "linkedin.com/in/promo-test-person-c";
const TEST_LINKEDIN_URLS = [LI_A, LI_B, LI_C];

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

/**
 * Remove every artefact this script may have created on previous runs.
 * Deletion order respects FK constraints (contacts before persons +
 * companies, staging rows before batches).
 */
async function cleanup(clientId: string) {
  // 1. Find all test contacts (those whose person OR company is a test entity).
  const testContacts = await db.contact.findMany({
    where: {
      clientId,
      OR: [
        { person: { linkedinUrl: { in: TEST_LINKEDIN_URLS } } },
        { company: { rootDomain: { in: TEST_DOMAINS } } },
      ],
    },
    select: { id: true },
  });
  const testContactIds = testContacts.map((c) => c.id);

  if (testContactIds.length > 0) {
    await db.gateStatusHistory.deleteMany({
      where: { contactId: { in: testContactIds } },
    });
    await db.contactCompanyRelationship.deleteMany({
      where: { contactId: { in: testContactIds } },
    });
    await db.contact.deleteMany({ where: { id: { in: testContactIds } } });
  }

  // 2. Delete test persons (after their contacts are gone).
  await db.person.deleteMany({
    where: { clientId, linkedinUrl: { in: TEST_LINKEDIN_URLS } },
  });

  // 3. Delete test companies (after their contacts are gone) + their aliases.
  const testCompanies = await db.company.findMany({
    where: { clientId, rootDomain: { in: TEST_DOMAINS } },
    select: { id: true },
  });
  if (testCompanies.length > 0) {
    const ids = testCompanies.map((c) => c.id);
    await db.domainAlias.deleteMany({ where: { companyId: { in: ids } } });
    await db.company.deleteMany({ where: { id: { in: ids } } });
  }

  // 4. Delete prior test batches + their staging rows + their audit entries.
  const testBatches = await db.importBatch.findMany({
    where: { clientId, fileName: { startsWith: TEST_FILE_PREFIX } },
    select: { id: true },
  });
  const testBatchIds = testBatches.map((b) => b.id);
  if (testBatchIds.length > 0) {
    await db.stagingRecord.deleteMany({
      where: { batchId: { in: testBatchIds } },
    });
    await db.auditLog.deleteMany({
      where: { action: "batch_promoted", resourceId: { in: testBatchIds } },
    });
    await db.importBatch.deleteMany({ where: { id: { in: testBatchIds } } });
  }
}

async function main() {
  // ---- Setup ----
  const client = await db.client.findFirst({
    where: { name: "Brightvision Internal" },
    select: { id: true },
  });
  if (!client) {
    throw new Error("Seeded 'Brightvision Internal' client not found — run npm run db:seed first.");
  }

  const dataOwner = await db.user.findFirst({
    where: { role: "data_owner" },
    select: { id: true },
  });
  if (!dataOwner) {
    throw new Error("Seeded data_owner user not found.");
  }

  await cleanup(client.id);

  // Row C reuses an existing seeded company so we can prove a brand-new
  // person can join a known company without creating a duplicate.
  const seededCompany = await db.company.findFirst({
    where: { clientId: client.id, mergedIntoId: null },
    select: { id: true, rootDomain: true },
  });
  if (!seededCompany) throw new Error("No seeded companies in Brightvision Internal.");

  // ---- Construct synthetic batch + staging rows ----
  const fileName = `${TEST_FILE_PREFIX}${Date.now()}.csv`;
  const batch = await db.importBatch.create({
    data: {
      clientId: client.id,
      fileName,
      fileSizeBytes: 2048,
      source: "manual",
      sourceDetail: "synthetic promotion test",
      uploadedBy: dataOwner.id,
      rowsTotal: 4,
      rowsAccepted: 4,
      rowsRejected: 0,
      status: "ready_for_review",
    },
    select: { id: true },
  });

  await db.stagingRecord.createMany({
    data: [
      // Row A: brand new person + brand new company
      {
        clientId: client.id,
        batchId: batch.id,
        rowNumber: 2,
        rawValues: JSON.stringify({ note: "row A — new person + new company" }),
        candidateEmail: "alice.promo@promo-test-a.test",
        candidateLinkedinUrl: LI_A,
        candidatePhone: "+46700000001",
        candidateFullName: "Alice Promo",
        candidateCompanyName: "Promo Test A",
        candidateDomain: DOMAIN_A,
        candidateTitle: "VP Sales",
        candidateCountry: "SE",
        status: "accepted",
      },
      // Row B: different person + different brand new company
      {
        clientId: client.id,
        batchId: batch.id,
        rowNumber: 3,
        rawValues: JSON.stringify({ note: "row B — new person + new company" }),
        candidateEmail: "bob.promo@promo-test-b.test",
        candidateLinkedinUrl: LI_B,
        candidatePhone: "+46700000002",
        candidateFullName: "Bob Promo",
        candidateCompanyName: "Promo Test B",
        candidateDomain: DOMAIN_B,
        candidateTitle: "Engineering Manager",
        candidateCountry: "SE",
        status: "accepted",
      },
      // Row C: brand new person joining an existing seeded company
      {
        clientId: client.id,
        batchId: batch.id,
        rowNumber: 4,
        rawValues: JSON.stringify({ note: "row C — new person on existing seeded company" }),
        candidateEmail: `charlie.promo@${seededCompany.rootDomain}`,
        candidateLinkedinUrl: LI_C,
        candidatePhone: "+46700000003",
        candidateFullName: "Charlie Promo",
        candidateCompanyName: null,
        candidateDomain: seededCompany.rootDomain,
        candidateTitle: "Account Executive",
        candidateCountry: "SE",
        status: "accepted",
      },
      // Row D: same linkedinUrl as Row A → should match A's person + contact
      {
        clientId: client.id,
        batchId: batch.id,
        rowNumber: 5,
        rawValues: JSON.stringify({ note: "row D — duplicate of A" }),
        candidateEmail: "alice.promo.dup@promo-test-a.test",
        candidateLinkedinUrl: LI_A,
        candidatePhone: "+46700000001",
        candidateFullName: "Alice Promo",
        candidateCompanyName: "Promo Test A",
        candidateDomain: DOMAIN_A,
        candidateTitle: "VP Sales",
        candidateCountry: "SE",
        status: "accepted",
      },
    ],
  });

  // ---- Run promotion ----
  const result = await promoteBatch({
    batchId: batch.id,
    actorUserId: dataOwner.id,
  });

  // ---- Output assertions ----
  check("output.batchId = test batch id", result.batchId === batch.id, batch.id, result.batchId);
  check("rowsAttempted = 4", result.rowsAttempted === 4, 4, result.rowsAttempted);
  check("rowsPromoted = 4", result.rowsPromoted === 4, 4, result.rowsPromoted);
  check("rowsSkipped = 0", result.rowsSkipped === 0, 0, result.rowsSkipped);
  check("newPersons = 3 (A, B, C)", result.newPersons === 3, 3, result.newPersons);
  check("newCompanies = 2 (A, B)", result.newCompanies === 2, 2, result.newCompanies);
  check("newContacts = 3 (A, B, C)", result.newContacts === 3, 3, result.newContacts);
  check(
    "matchedExistingContacts = 1 (D matches A)",
    result.matchedExistingContacts === 1,
    1,
    result.matchedExistingContacts,
  );
  check("errors = []", result.errors.length === 0, [], result.errors);

  // ---- Side-effect assertions: staging rows ----
  const staging = await db.stagingRecord.findMany({
    where: { batchId: batch.id },
    orderBy: { rowNumber: "asc" },
    select: { rowNumber: true, status: true, promotedContactId: true, promotedAt: true },
  });
  check("staging: 4 rows", staging.length === 4, 4, staging.length);
  check(
    "staging: all 4 rows status=promoted",
    staging.every((r) => r.status === "promoted"),
    true,
    staging.map((r) => r.status),
  );
  check(
    "staging: all 4 rows have promotedContactId",
    staging.every((r) => r.promotedContactId !== null),
    true,
    staging.map((r) => r.promotedContactId),
  );
  check(
    "staging: all 4 rows have promotedAt",
    staging.every((r) => r.promotedAt !== null),
    true,
  );

  // ---- Side-effect: ImportBatch terminal state ----
  const finalBatch = await db.importBatch.findUnique({
    where: { id: batch.id },
    select: { status: true, rowsPromoted: true, completedAt: true },
  });
  check(
    "ImportBatch status = completed",
    finalBatch?.status === "completed",
    "completed",
    finalBatch?.status,
  );
  check(
    "ImportBatch rowsPromoted = 4",
    finalBatch?.rowsPromoted === 4,
    4,
    finalBatch?.rowsPromoted,
  );
  check("ImportBatch completedAt set", finalBatch?.completedAt !== null);

  // ---- Side-effect: GateStatusHistory ----
  // Rows A, B, C each transitioned a fresh contact from gate_0 → gate_1.
  // Row D matched an existing contact already at gate_1 → no new history row.
  const promotedContactIds = staging.map((r) => r.promotedContactId!).filter(Boolean);
  const uniquePromotedContactIds = Array.from(new Set(promotedContactIds));
  const gateHistory = await db.gateStatusHistory.findMany({
    where: {
      contactId: { in: uniquePromotedContactIds },
      reason: "intake_promotion",
      toGate: "gate_1",
    },
    select: { contactId: true, fromGate: true },
  });
  check(
    "gate_status_history: exactly 3 rows for this batch (A, B, C)",
    gateHistory.length === 3,
    3,
    gateHistory.length,
  );
  check(
    "gate_status_history: all 3 transitions have fromGate=null (created fresh)",
    gateHistory.every((h) => h.fromGate === null),
    true,
    gateHistory.map((h) => h.fromGate),
  );

  // Sanity: row D's contact is the same as row A's, and it's at gate_1.
  const rowA = staging.find((r) => r.rowNumber === 2)!;
  const rowD = staging.find((r) => r.rowNumber === 5)!;
  check(
    "row D promotedContactId = row A promotedContactId",
    rowA.promotedContactId === rowD.promotedContactId,
    rowA.promotedContactId,
    rowD.promotedContactId,
  );
  const sharedContact = await db.contact.findUnique({
    where: { id: rowA.promotedContactId! },
    select: { gateStatus: true, writeSource: true },
  });
  check(
    "shared contact (A & D) ended at gate_1 with writeSource=intake",
    sharedContact?.gateStatus === "gate_1" && sharedContact?.writeSource === "intake",
    { gateStatus: "gate_1", writeSource: "intake" },
    sharedContact,
  );

  // ---- Side-effect: AuditLog ----
  const auditRows = await db.auditLog.findMany({
    where: {
      action: "batch_promoted",
      resourceId: batch.id,
    },
    select: {
      actorUserId: true,
      recordsAffected: true,
      afterState: true,
    },
  });
  check("audit_log: exactly 1 batch_promoted entry", auditRows.length === 1, 1, auditRows.length);
  check(
    "audit_log: actorUserId = data_owner",
    auditRows[0]?.actorUserId === dataOwner.id,
    dataOwner.id,
    auditRows[0]?.actorUserId,
  );
  check(
    "audit_log: recordsAffected = 4",
    auditRows[0]?.recordsAffected === 4,
    4,
    auditRows[0]?.recordsAffected,
  );
  const afterStateParsed = auditRows[0]?.afterState
    ? JSON.parse(auditRows[0].afterState)
    : null;
  check(
    "audit_log: afterState mirrors PromotionOutput counts",
    afterStateParsed?.rowsPromoted === 4 &&
      afterStateParsed?.newPersons === 3 &&
      afterStateParsed?.newCompanies === 2 &&
      afterStateParsed?.matchedExistingContacts === 1,
    { rowsPromoted: 4, newPersons: 3, newCompanies: 2, matchedExistingContacts: 1 },
    afterStateParsed,
  );

  // ---- Idempotency guard ----
  let secondCallThrew = false;
  try {
    await promoteBatch({ batchId: batch.id, actorUserId: dataOwner.id });
  } catch {
    secondCallThrew = true;
  }
  check("re-promotion of completed batch throws", secondCallThrew);

  console.log("");
  console.log(`${passed} passed, ${failed} failed`);

  await db.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
