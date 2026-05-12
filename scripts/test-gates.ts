/**
 * End-to-end exercise of the gate promotion engine.
 *
 * Six synthetic test contacts are created via programmatic promotion so each
 * test path can stage exactly the contact state it needs. The script is
 * idempotent: prior test residue is wiped at start so repeated runs produce
 * identical PASS counts.
 *
 * Test paths:
 *   1. Promotion path  — 3 gate_1 contacts pass all 5 checks → all promoted
 *      to gate_2 + 3 GateStatusHistory rows.
 *   2. Bounce path     — 1 gate_2 contact, latest email verification flips
 *      to "invalid" → downgraded to gate_1 + quarantineReason="bounce" +
 *      QuarantineLog row created.
 *   3. Freshness path  — 1 gate_2 contact, lastVerifiedAt back-dated 120 days
 *      → downgraded to gate_1 with reason "freshness_expired", no quarantine.
 *   4. No-change path  — 1 gate_1 contact with no valid email verification →
 *      evaluation only (no apply), decision="no_change", blockers populated.
 *
 * Run with: npm run test:gates
 */
import { db } from "../src/lib/db";
import {
  evaluateAndApplyBulk,
  evaluateContact,
} from "../src/services/gates";
import { promoteBatch } from "../src/services/promotion";

// Stable markers — used to identify test residue at cleanup time.
const TEST_BATCH_PREFIX = "test-gates-";
const TEST_DOMAIN = "gates-test.test";
const TEST_LINKEDIN_PREFIX = "linkedin.com/in/gates-test-";
const TEST_LINKEDIN_IDS = [
  "promo-a",
  "promo-b",
  "promo-c",
  "bounce",
  "freshness",
  "nochange",
] as const;
const TEST_LINKEDIN_URLS = TEST_LINKEDIN_IDS.map((id) => `${TEST_LINKEDIN_PREFIX}${id}`);

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
  const priorPersons = await db.person.findMany({
    where: { linkedinUrl: { in: TEST_LINKEDIN_URLS } },
    select: { id: true },
  });
  const priorPersonIds = priorPersons.map((p) => p.id);

  const priorContacts = await db.contact.findMany({
    where: { personId: { in: priorPersonIds } },
    select: { id: true },
  });
  const priorContactIds = priorContacts.map((c) => c.id);

  if (priorContactIds.length) {
    await db.verification.deleteMany({ where: { contactId: { in: priorContactIds } } });
    await db.gateStatusHistory.deleteMany({ where: { contactId: { in: priorContactIds } } });
    await db.quarantineLog.deleteMany({ where: { contactId: { in: priorContactIds } } });
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
  await db.auditLog.deleteMany({
    where: { action: "gate_evaluation_completed" },
  });
  await db.company.deleteMany({
    where: { rootDomain: TEST_DOMAIN },
  });
}

async function ensureSyntheticContacts(
  clientId: string,
  actorUserId: string,
): Promise<Record<(typeof TEST_LINKEDIN_IDS)[number], string>> {
  const batch = await db.importBatch.create({
    data: {
      clientId,
      fileName: `${TEST_BATCH_PREFIX}${Date.now()}.csv`,
      fileSizeBytes: 512,
      source: "manual",
      uploadedBy: actorUserId,
      rowsTotal: TEST_LINKEDIN_IDS.length,
      rowsAccepted: TEST_LINKEDIN_IDS.length,
      status: "ready_for_review",
    },
  });

  await db.stagingRecord.createMany({
    data: TEST_LINKEDIN_IDS.map((slug, idx) => ({
      clientId,
      batchId: batch.id,
      rowNumber: idx + 1,
      rawValues: JSON.stringify({ email: `gates.test.${slug}@${TEST_DOMAIN}` }),
      candidateEmail: `gates.test.${slug}@${TEST_DOMAIN}`,
      candidateLinkedinUrl: `${TEST_LINKEDIN_PREFIX}${slug}`,
      candidatePhone: null,
      candidateFullName: `Gates Test ${slug}`,
      candidateCompanyName: "Gates Test Company",
      candidateDomain: TEST_DOMAIN,
      candidateTitle: "Test Title",
      candidateCountry: "SE",
      status: "accepted",
    })),
  });

  await promoteBatch({ batchId: batch.id, actorUserId });

  const promoted = await db.stagingRecord.findMany({
    where: { batchId: batch.id, status: "promoted" },
    select: { rowNumber: true, promotedContactId: true },
    orderBy: { rowNumber: "asc" },
  });

  const ids = {} as Record<(typeof TEST_LINKEDIN_IDS)[number], string>;
  for (const row of promoted) {
    const slug = TEST_LINKEDIN_IDS[row.rowNumber - 1];
    if (slug && row.promotedContactId) {
      ids[slug] = row.promotedContactId;
    }
  }
  return ids;
}

async function insertEmailVerification(
  clientId: string,
  contactId: string,
  status: "valid" | "invalid",
  createdAt: Date,
) {
  return db.verification.create({
    data: {
      clientId,
      contactId,
      verificationType: "email",
      provider: "millionverifier",
      status,
      confidence: status === "valid" ? 0.92 : 0.99,
      creditsUsed: 1,
      rawResponse: JSON.stringify({ synthetic: true, status }),
      createdAt,
    },
  });
}

async function main() {
  console.log("Running gate promotion tests against dev.db ...\n");

  const [client, dataOwner] = await Promise.all([
    db.client.findFirst({ where: { name: "Brightvision Internal" } }),
    db.user.findFirst({ where: { role: "data_owner" } }),
  ]);
  if (!client || !dataOwner) {
    console.error("Seed prerequisites missing — run `npm run db:seed` first.");
    process.exit(1);
  }

  await cleanup();
  const ids = await ensureSyntheticContacts(client.id, dataOwner.id);
  check(
    "Setup: 6 synthetic intake contacts created (writeSource=intake)",
    Object.keys(ids).length === 6,
    6,
    Object.keys(ids).length,
  );

  // Sanity: promoted contacts default to gate_1 with writeSource=intake.
  const baseline = await db.contact.findMany({
    where: { id: { in: Object.values(ids) } },
    select: { id: true, gateStatus: true, writeSource: true },
  });
  check(
    "Setup: all 6 contacts start at gate_1 with writeSource=intake",
    baseline.every(
      (c) => c.gateStatus === "gate_1" && c.writeSource === "intake",
    ),
    "gate_1 + intake",
    baseline,
  );

  const now = new Date();
  const recent = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000); // 5 days ago

  // ===========================================================
  // PATH 1 — Promotion (gate_1 → gate_2)
  // ===========================================================
  console.log("\n--- Path 1: promotion (gate_1 → gate_2) ---");
  const promoIds = [ids["promo-a"]!, ids["promo-b"]!, ids["promo-c"]!];
  for (const id of promoIds) {
    await db.contact.update({
      where: { id },
      data: {
        title: "VP Sales",
        lastVerifiedAt: recent,
        quarantineReason: null,
      },
    });
    await insertEmailVerification(client.id, id, "valid", recent);
  }

  const promoResult = await evaluateAndApplyBulk(promoIds, dataOwner.id);
  check("path1: promoted === 3", promoResult.promoted === 3, 3, promoResult.promoted);
  check("path1: downgraded === 0", promoResult.downgraded === 0, 0, promoResult.downgraded);
  check("path1: unchanged === 0", promoResult.unchanged === 0, 0, promoResult.unchanged);

  const promoContacts = await db.contact.findMany({
    where: { id: { in: promoIds } },
    select: { id: true, gateStatus: true, derivedFieldVersion: true },
  });
  check(
    "path1: all 3 contacts now at gate_2",
    promoContacts.every((c) => c.gateStatus === "gate_2"),
    "gate_2 x 3",
    promoContacts,
  );
  check(
    "path1: derivedFieldVersion stamped on all 3",
    promoContacts.every((c) => c.derivedFieldVersion === "v1"),
    "v1 x 3",
    promoContacts.map((c) => c.derivedFieldVersion),
  );

  const promoHistory = await db.gateStatusHistory.findMany({
    where: {
      contactId: { in: promoIds },
      toGate: "gate_2",
      reason: "trust_floor_met",
    },
  });
  check(
    "path1: 3 GateStatusHistory rows (gate_1 → gate_2, trust_floor_met)",
    promoHistory.length === 3,
    3,
    promoHistory.length,
  );
  check(
    "path1: every history row has fromGate=gate_1",
    promoHistory.every((h) => h.fromGate === "gate_1"),
    "all gate_1",
    promoHistory.map((h) => h.fromGate),
  );

  // ===========================================================
  // PATH 2 — Bounce downgrade (gate_2 → gate_1 + quarantine)
  // ===========================================================
  console.log("\n--- Path 2: bounce downgrade ---");
  const bounceId = ids["bounce"]!;
  await db.contact.update({
    where: { id: bounceId },
    data: {
      gateStatus: "gate_2",
      title: "Sales Director",
      lastVerifiedAt: recent,
      quarantineReason: null,
    },
  });
  // First a valid verification (older), then a fresh invalid one — "latest"
  // wins for criterion 2.
  await insertEmailVerification(
    client.id,
    bounceId,
    "valid",
    new Date(now.getTime() - 60 * 1000),
  );
  await insertEmailVerification(client.id, bounceId, "invalid", now);

  const bounceResult = await evaluateAndApplyBulk([bounceId], dataOwner.id);
  check("path2: downgraded === 1", bounceResult.downgraded === 1, 1, bounceResult.downgraded);
  check(
    "path2: quarantined === 1",
    bounceResult.quarantined === 1,
    1,
    bounceResult.quarantined,
  );

  const bounceContact = await db.contact.findUnique({
    where: { id: bounceId },
    select: { gateStatus: true, quarantineReason: true },
  });
  check(
    "path2: contact gateStatus === gate_1",
    bounceContact?.gateStatus === "gate_1",
    "gate_1",
    bounceContact?.gateStatus,
  );
  check(
    "path2: contact quarantineReason === 'bounce'",
    bounceContact?.quarantineReason === "bounce",
    "bounce",
    bounceContact?.quarantineReason,
  );

  const bounceHistory = await db.gateStatusHistory.findFirst({
    where: {
      contactId: bounceId,
      fromGate: "gate_2",
      toGate: "gate_1",
      reason: "bounce_detected",
    },
  });
  check(
    "path2: GateStatusHistory row created (gate_2 → gate_1, bounce_detected)",
    bounceHistory !== null,
    "exists",
    bounceHistory,
  );

  const bounceQuar = await db.quarantineLog.findFirst({
    where: { contactId: bounceId, reasonCode: "bounce", reviewState: "pending" },
  });
  check(
    "path2: QuarantineLog row created (reasonCode=bounce, reviewState=pending)",
    bounceQuar !== null,
    "exists",
    bounceQuar,
  );

  // ===========================================================
  // PATH 3 — Freshness downgrade (gate_2 → gate_1, no quarantine)
  // ===========================================================
  console.log("\n--- Path 3: freshness downgrade ---");
  const freshId = ids["freshness"]!;
  const stale = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000);
  await db.contact.update({
    where: { id: freshId },
    data: {
      gateStatus: "gate_2",
      title: "Solutions Architect",
      lastVerifiedAt: stale,
      quarantineReason: null,
    },
  });
  // Add a fresh valid verification so criterion 2 still passes — only
  // criterion 3 (Contact.lastVerifiedAt freshness window) should fail.
  await insertEmailVerification(client.id, freshId, "valid", now);

  const freshResult = await evaluateAndApplyBulk([freshId], dataOwner.id);
  check("path3: downgraded === 1", freshResult.downgraded === 1, 1, freshResult.downgraded);
  check(
    "path3: quarantined === 0 (freshness alone never quarantines)",
    freshResult.quarantined === 0,
    0,
    freshResult.quarantined,
  );

  const freshContact = await db.contact.findUnique({
    where: { id: freshId },
    select: { gateStatus: true, quarantineReason: true },
  });
  check(
    "path3: contact downgraded to gate_1",
    freshContact?.gateStatus === "gate_1",
    "gate_1",
    freshContact?.gateStatus,
  );
  check(
    "path3: quarantineReason still null",
    freshContact?.quarantineReason === null,
    null,
    freshContact?.quarantineReason,
  );

  const freshHistory = await db.gateStatusHistory.findFirst({
    where: {
      contactId: freshId,
      fromGate: "gate_2",
      toGate: "gate_1",
      reason: "freshness_expired",
    },
  });
  check(
    "path3: GateStatusHistory row created (freshness_expired)",
    freshHistory !== null,
    "exists",
    freshHistory,
  );

  const freshQuar = await db.quarantineLog.count({
    where: { contactId: freshId },
  });
  check(
    "path3: no QuarantineLog row was created for this contact",
    freshQuar === 0,
    0,
    freshQuar,
  );

  // ===========================================================
  // PATH 4 — No-change (evaluation only)
  // ===========================================================
  console.log("\n--- Path 4: no-change evaluation ---");
  const stayId = ids["nochange"]!;
  // Leave title null, no email verification, no lastVerifiedAt — every
  // discretionary check should fail.
  await db.contact.update({
    where: { id: stayId },
    data: {
      gateStatus: "gate_1",
      title: null,
      lastVerifiedAt: null,
      quarantineReason: null,
      mergedIntoId: null,
    },
  });
  await db.verification.deleteMany({ where: { contactId: stayId } });

  const evaluation = await evaluateContact(stayId);
  check(
    "path4: decision === 'no_change'",
    evaluation.decision === "no_change",
    "no_change",
    evaluation.decision,
  );
  check(
    "path4: blockers includes 'structurallyComplete'",
    evaluation.blockers.includes("structurallyComplete"),
    "includes structurallyComplete",
    evaluation.blockers,
  );
  check(
    "path4: blockers includes 'emailDeliverable'",
    evaluation.blockers.includes("emailDeliverable"),
    "includes emailDeliverable",
    evaluation.blockers,
  );
  check(
    "path4: blockers includes 'freshnessValid'",
    evaluation.blockers.includes("freshnessValid"),
    "includes freshnessValid",
    evaluation.blockers,
  );
  check(
    "path4: proposedGate stays at gate_1",
    evaluation.proposedGate === "gate_1",
    "gate_1",
    evaluation.proposedGate,
  );

  // Verify nothing was applied — gateStatus still gate_1, no history row
  // for this contact.
  const stayContact = await db.contact.findUnique({
    where: { id: stayId },
    select: { gateStatus: true },
  });
  check(
    "path4: contact still at gate_1 (no apply happened)",
    stayContact?.gateStatus === "gate_1",
    "gate_1",
    stayContact?.gateStatus,
  );
  // The promotion service writes an "intake_promotion" history row when each
  // synthetic contact is first promoted from gate_0 to gate_1; that's expected.
  // We're asserting the gates service didn't add anything on top of that.
  const stayHistory = await db.gateStatusHistory.count({
    where: { contactId: stayId, reason: { not: "intake_promotion" } },
  });
  check(
    "path4: no GateStatusHistory rows from the gates service (only intake_promotion remains)",
    stayHistory === 0,
    0,
    stayHistory,
  );

  // ===========================================================
  // Audit-log assertion
  // ===========================================================
  console.log("\n--- Audit log ---");
  const auditCount = await db.auditLog.count({
    where: { action: "gate_evaluation_completed" },
  });
  check(
    "audit_log: ≥ 3 gate_evaluation_completed rows (one per bulk call)",
    auditCount >= 3,
    "≥ 3",
    auditCount,
  );

  // ---- Summary ----
  console.log("");
  console.log(`Results: ${passed} passed, ${failed} failed.`);
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
