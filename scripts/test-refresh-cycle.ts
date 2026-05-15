/**
 * End-to-end refresh cycle orchestrator test (Phase 9.1).
 *
 * Run: npm run test:refresh-cycle
 */
import { db } from "../src/lib/db";
import { runRefreshCycle } from "../src/services/refreshCycle";

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

async function cleanupCreatedRefreshArtifacts(refreshLogIds: string[]) {
  if (refreshLogIds.length === 0) return;
  await db.auditLog.deleteMany({ where: { resourceId: { in: refreshLogIds } } });
  await db.refreshLog.deleteMany({ where: { id: { in: refreshLogIds } } });
}

async function cleanupSyntheticContact(contactId: string, personId?: string) {
  if (personId) {
    await db.contact.deleteMany({ where: { id: contactId } });
    await db.person.deleteMany({ where: { id: personId } });
  } else {
    await db.contact.deleteMany({ where: { id: contactId } });
  }
}

async function main() {
  const dataOwner = await db.user.findFirst({
    where: { role: "data_owner", active: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, clientId: true, role: true },
  });
  if (!dataOwner) throw new Error("No active data_owner user found");

  const internalClient = await db.client.findFirst({
    where: { name: "Brightvision Internal" },
    select: { id: true },
  });
  if (!internalClient) throw new Error("Brightvision Internal client not found");

  const clientId = internalClient.id;

  // ---- Pre-state ----
  const preRefreshCount = await db.refreshLog.count({ where: { clientId } });
  const preGate2Count = await db.contact.count({
    where: { gateStatus: "gate_2", mergedIntoId: null, lifecycleStage: "active" },
  });
  const preGateHistoryCount = await db.gateStatusHistory.count({ where: { clientId } });

  const createdRefreshLogIds: string[] = [];

  // ---- Normal refresh path (verification+enrichment+gates, no anonymisation) ----
  const result = await runRefreshCycle({
    clientId,
    maxContacts: 10,
    performAnonymisation: false,
    actorUserId: dataOwner.id,
  });
  createdRefreshLogIds.push(result.refreshLogId);

  check(
    "contactsProcessed > 0 when gate_2 exists",
    preGate2Count === 0 ? true : result.contactsProcessed > 0,
    result.contactsProcessed,
    { gate2Count: preGate2Count },
  );
  check(
    "verification succeeded+failed equals contactsProcessed",
    result.verification.succeeded + result.verification.failed === result.contactsProcessed,
    result.contactsProcessed,
    result.verification,
  );
  check(
    "enrichment totals equals contactsProcessed",
    result.enrichment.enriched +
      result.enrichment.noMatch +
      result.enrichment.skipped +
      result.enrichment.failed === result.contactsProcessed,
    result.contactsProcessed,
    result.enrichment,
  );
  check(
    "gates totals equals contactsProcessed",
    result.gates.promoted + result.gates.downgraded + result.gates.unchanged ===
      result.contactsProcessed,
    result.contactsProcessed,
    result.gates,
  );

  const refreshLogRow = await db.refreshLog.findUnique({
    where: { id: result.refreshLogId },
    select: { id: true, status: true, cycleNumber: true, costEstimate: true },
  });
  check("RefreshLog row exists", Boolean(refreshLogRow));
  check("RefreshLog status completed", refreshLogRow?.status === "completed", "completed", refreshLogRow?.status);
  check(
    "RefreshLog cycleNumber matches expectation",
    refreshLogRow?.cycleNumber === preRefreshCount + 1,
    preRefreshCount + 1,
    refreshLogRow?.cycleNumber,
  );
  check("RefreshLog costEstimate > 0", (refreshLogRow?.costEstimate ?? 0) > 0, true, refreshLogRow?.costEstimate);

  const completedAuditCount = await db.auditLog.count({
    where: {
      action: "refresh_cycle_completed",
      resourceType: "refresh_log",
      resourceId: result.refreshLogId,
    },
  });
  check("At least 1 refresh_cycle_completed audit row", completedAuditCount >= 1, 1, completedAuditCount);

  const postGateHistoryCount = await db.gateStatusHistory.count({ where: { clientId } });
  const hadGateTransition = result.gates.promoted + result.gates.downgraded > 0;
  check(
    "gate_status_history count grew when there are gate transitions",
    hadGateTransition ? postGateHistoryCount > preGateHistoryCount : postGateHistoryCount === preGateHistoryCount,
    hadGateTransition ? `>${preGateHistoryCount}` : `==${preGateHistoryCount}`,
    postGateHistoryCount,
  );

  // ---- Anonymisation-only path (maxContacts=0) ----
  const company = await db.company.findFirst({
    where: { clientId },
    select: { id: true },
  });
  if (!company) throw new Error("No company in internal client");

  const fourHundredDaysAgo = new Date();
  fourHundredDaysAgo.setDate(fourHundredDaysAgo.getDate() - 400);
  const unique = Date.now().toString(36);
  const testEmail = `ai_refresh_cycle_test_${unique}@example.com`;
  const testPhone = "+14155550123";
  const testLinkedin = `linkedin.com/in/ai-refresh-test-${unique}`;

  const syntheticPerson = await db.person.create({
    data: {
      clientId,
      linkedinUrl: testLinkedin,
      primaryEmail: testEmail,
      primaryPhone: testPhone,
      fullName: "AI Refresh Cycle Test",
      firstName: "Alex",
      lastName: "Tester",
      inferredGender: "M",
    },
  });

  const syntheticContact = await db.contact.create({
    data: {
      clientId,
      personId: syntheticPerson.id,
      companyId: company.id,
      email: testEmail,
      phone: testPhone,
      title: "Test Title",
      gateStatus: "gate_0",
      campaignActive: false,
      quarantineReason: null,
      lifecycleStage: "active",
      mergedIntoId: null,
      lastVerifiedAt: fourHundredDaysAgo,
      createdAt: fourHundredDaysAgo,
    },
  });

  const anonymisationResult = await runRefreshCycle({
    clientId,
    maxContacts: 0,
    performAnonymisation: true,
    actorUserId: dataOwner.id,
  });
  createdRefreshLogIds.push(anonymisationResult.refreshLogId);

  const updatedSyntheticContact = await db.contact.findUnique({
    where: { id: syntheticContact.id },
    select: { id: true, email: true, lifecycleStage: true, personId: true },
  });
  const updatedSyntheticPerson = await db.person.findUnique({
    where: { id: syntheticPerson.id },
    select: { id: true, fullName: true },
  });

  check(
    "synthetic contact email stripped",
    updatedSyntheticContact?.email === null,
    null,
    updatedSyntheticContact?.email,
  );
  check(
    "synthetic contact lifecycleStage anonymised",
    updatedSyntheticContact?.lifecycleStage === "anonymised",
    "anonymised",
    updatedSyntheticContact?.lifecycleStage,
  );
  check(
    "synthetic person fullName set to ANONYMISED",
    updatedSyntheticPerson?.fullName === "ANONYMISED",
    "ANONYMISED",
    updatedSyntheticPerson?.fullName,
  );

  // ---- Cleanup ----
  await cleanupSyntheticContact(syntheticContact.id, syntheticPerson.id);
  await cleanupCreatedRefreshArtifacts(createdRefreshLogIds);

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

