/**
 * End-to-end exercise of the intake service against the live dev.db.
 *
 * Runs against the seeded "Brightvision Internal" client + a data_owner user.
 * Constructs a synthetic ParseResult with one of every interesting outcome
 * (valid x2, validation error, tombstoned email, two duplicate flavours) and
 * asserts the IntakeOutput totals + the persisted side effects.
 *
 * Idempotent: the tombstone is upserted, and each run creates a fresh batch.
 *
 * Run with:  npm run test:intake
 */
import { db } from "../src/lib/db";
import { intake } from "../src/services/intake";
import { hashEmail } from "../src/lib/hashing";
import type { ParsedCsvRow, ParseResult } from "../src/types/intake";

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`PASS  ${name}`);
    passed += 1;
  } else {
    console.log(`FAIL  ${name}`);
    console.log(`      expected: ${JSON.stringify(expected)}`);
    console.log(`      actual:   ${JSON.stringify(actual)}`);
    failed += 1;
  }
}

function checkTruthy(name: string, value: unknown) {
  if (value) {
    console.log(`PASS  ${name}`);
    passed += 1;
  } else {
    console.log(`FAIL  ${name}`);
    console.log(`      value was: ${JSON.stringify(value)}`);
    failed += 1;
  }
}

/** Shorthand for building a ParsedCsvRow with a base candidate filled in. */
function makeRow(
  rowNumber: number,
  candidate: Partial<ParsedCsvRow["candidate"]>,
  validationErrors: string[] = [],
): ParsedCsvRow {
  return {
    rowNumber,
    rawValues: {},
    candidate: {
      email: null,
      linkedinUrl: null,
      phone: null,
      fullName: null,
      firstName: null,
      lastName: null,
      title: null,
      companyName: null,
      domain: null,
      country: null,
      ...candidate,
    },
    validationErrors,
  };
}

async function main() {
  // ---- Look up seeded actors ----
  const client = await db.client.findFirst({
    where: { name: "Brightvision Internal" },
    select: { id: true },
  });
  if (!client) throw new Error("Seeded 'Brightvision Internal' client not found — run npm run db:seed first.");

  const dataOwner = await db.user.findFirst({
    where: { role: "data_owner" },
    select: { id: true },
  });
  if (!dataOwner) throw new Error("Seeded data_owner user not found — run npm run db:seed first.");

  // ---- Pre-insert a tombstone for a known test email (idempotent) ----
  const tombstonedEmail = "tombstoned@example-test.com";
  const tombHash = hashEmail(tombstonedEmail);
  if (!tombHash) throw new Error("hashEmail returned null for the test email — impossible.");

  await db.tombstone.upsert({
    where: {
      hashType_hashValue: { hashType: "email_sha256", hashValue: tombHash },
    },
    update: {},
    create: {
      hashType: "email_sha256",
      hashValue: tombHash,
      originalClientId: client.id,
      deletionReason: "manual_owner_request",
      deletionActor: dataOwner.id,
    },
  });

  // ---- Build a synthetic 6-row ParseResult ----
  // Row 2: valid identity #1 (acts as the "earlier row" for duplicate rows 6 & 7)
  // Row 3: valid identity #2
  // Row 4: validation error — should reject before tombstone or dedup checks fire
  // Row 5: tombstoned email — must reject regardless of in-batch state
  // Row 6: duplicate of row 2's email
  // Row 7: duplicate of row 2's linkedinUrl (different email)
  const rows: ParsedCsvRow[] = [
    makeRow(2, {
      email: "first.valid@test.com",
      fullName: "First Valid",
      linkedinUrl: "linkedin.com/in/first-valid",
    }),
    makeRow(3, {
      email: "second.valid@test.com",
      fullName: "Second Valid",
      linkedinUrl: "linkedin.com/in/second-valid",
    }),
    makeRow(
      4,
      { fullName: "Missing Identifier" },
      ["missing identifier: need email or linkedinUrl"],
    ),
    makeRow(5, {
      email: tombstonedEmail,
      fullName: "Tombstoned Person",
    }),
    makeRow(6, {
      email: "first.valid@test.com",
      fullName: "Duplicate Email",
    }),
    makeRow(7, {
      email: "different.email@test.com",
      fullName: "Duplicate LinkedIn",
      linkedinUrl: "linkedin.com/in/first-valid",
    }),
  ];

  const parseResult: ParseResult = {
    totalRows: rows.length,
    validRows: rows.filter((r) => r.validationErrors.length === 0).length,
    invalidRows: rows.filter((r) => r.validationErrors.length > 0).length,
    rows,
    fileLevelErrors: [],
  };

  // ---- Run intake ----
  const result = await intake({
    clientId: client.id,
    fileName: "test-intake.csv",
    fileSizeBytes: 1024,
    source: "manual",
    sourceDetail: "test-intake.ts synthetic input",
    uploadedBy: dataOwner.id,
    parseResult,
  });

  // ---- Summary assertions ----
  check("rowsTotal = 6", result.rowsTotal, 6);
  check("rowsAccepted = 2", result.rowsAccepted, 2);
  check("rowsRejected = 4", result.rowsRejected, 4);

  check("rejectionBreakdown matches expected", result.rejectionBreakdown, {
    tombstoned_email: 1,
    tombstoned_linkedin: 0,
    tombstoned_phone: 0,
    missing_required_fields: 0,
    validation_failed: 1,
    duplicate_in_batch: 2,
  });

  // ---- Side-effect assertions ----
  const batchInDb = await db.importBatch.findUnique({
    where: { id: result.batchId },
  });
  checkTruthy("ImportBatch row exists", batchInDb);
  check(
    "ImportBatch status = ready_for_review",
    batchInDb?.status,
    "ready_for_review",
  );
  check("ImportBatch rowsTotal mirrored", batchInDb?.rowsTotal, 6);
  check("ImportBatch rowsAccepted mirrored", batchInDb?.rowsAccepted, 2);
  check("ImportBatch rowsRejected mirrored", batchInDb?.rowsRejected, 4);
  checkTruthy("ImportBatch completedAt set", batchInDb?.completedAt);

  const stagingCount = await db.stagingRecord.count({
    where: { batchId: result.batchId },
  });
  check("staging_records: 6 rows for this batch", stagingCount, 6);

  const acceptedCount = await db.stagingRecord.count({
    where: { batchId: result.batchId, status: "accepted" },
  });
  check("staging_records: 2 accepted", acceptedCount, 2);

  const rejectedCount = await db.stagingRecord.count({
    where: { batchId: result.batchId, status: "rejected" },
  });
  check("staging_records: 4 rejected", rejectedCount, 4);

  // Spot-check the per-row rejection reasons
  const reasons = await db.stagingRecord.findMany({
    where: { batchId: result.batchId },
    orderBy: { rowNumber: "asc" },
    select: { rowNumber: true, status: true, rejectionReason: true },
  });
  check(
    "per-row outcomes match precedence",
    reasons.map((r) => `${r.rowNumber}:${r.status}:${r.rejectionReason ?? "-"}`),
    [
      "2:accepted:-",
      "3:accepted:-",
      "4:rejected:validation_failed",
      "5:rejected:tombstoned_email",
      "6:rejected:duplicate_in_batch",
      "7:rejected:duplicate_in_batch",
    ],
  );

  const auditEntry = await db.auditLog.findFirst({
    where: { resourceId: result.batchId, action: "intake_completed" },
  });
  checkTruthy("audit_log: intake_completed entry recorded", auditEntry);
  check("audit_log: actorUserId = uploadedBy", auditEntry?.actorUserId, dataOwner.id);
  check("audit_log: recordsAffected = 6", auditEntry?.recordsAffected, 6);

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
