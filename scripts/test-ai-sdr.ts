/**
 * AI SDR platform ↔ master DB contract (Phase 6.1).
 *
 * Run: npm run test:ai-sdr
 */
import { db } from "../src/lib/db";
import {
  assignToCampaign,
  registerBounceEvent,
  registerReplyEvent,
} from "../src/services/aiSdrEvents";
import { buildTargetingList } from "../src/services/targeting";

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

async function cleanupAiSdrTestArtifacts(dataOwnerId: string) {
  const audits = await db.auditLog.findMany({
    where: { action: "campaign_assigned", actorUserId: dataOwnerId },
    select: { id: true, afterState: true },
  });
  const auditIds: string[] = [];
  const contactIds = new Set<string>();
  for (const a of audits) {
    try {
      const j = JSON.parse(a.afterState ?? "{}") as {
        campaignLabel?: string;
        contactIds?: string[];
      };
      if (j.campaignLabel === "Test Campaign" && Array.isArray(j.contactIds)) {
        auditIds.push(a.id);
        for (const id of j.contactIds) {
          if (typeof id === "string") contactIds.add(id);
        }
      }
    } catch {
      /* skip */
    }
  }

  const sups = await db.suppression.findMany({
    where: { reasonDetail: { contains: "ai_sdr_test" } },
    select: { id: true, contactId: true },
  });
  for (const s of sups) {
    if (s.contactId) contactIds.add(s.contactId);
  }
  await db.suppression.deleteMany({ where: { id: { in: sups.map((s) => s.id) } } });

  const ids = [...contactIds];
  if (ids.length) {
    await db.verification.deleteMany({
      where: { contactId: { in: ids }, provider: "ai_sdr_platform" },
    });
    await db.quarantineLog.deleteMany({
      where: { contactId: { in: ids }, reasonCode: "bounce" },
    });
    await db.contact.updateMany({
      where: { id: { in: ids } },
      data: {
        campaignActive: false,
        writeSource: null,
        quarantineReason: null,
        gateStatus: "gate_2",
      },
    });
  }

  if (auditIds.length) {
    await db.auditLog.deleteMany({ where: { id: { in: auditIds } } });
  }
}

async function main() {
  const dataOwner = await db.user.findFirst({
    where: { role: "data_owner", active: true },
    orderBy: { createdAt: "asc" },
  });
  check("data_owner user exists", Boolean(dataOwner));
  if (!dataOwner) {
    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
    return;
  }

  const internal = await db.client.findFirst({
    where: { name: "Brightvision Internal" },
    select: { id: true },
  });
  check("Brightvision Internal client exists", Boolean(internal));
  if (!internal) {
    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    process.exit(1);
    return;
  }

  await cleanupAiSdrTestArtifacts(dataOwner.id);

  const targeting = await buildTargetingList({
    clientId: internal.id,
    gates: ["gate_2"],
    limit: 10,
  });

  check("targeting returned >= 1", targeting.returned >= 1, ">=1", targeting.returned);
  check(
    "targeting totalEligible >= returned",
    targeting.totalEligible >= targeting.returned,
    true,
    { totalEligible: targeting.totalEligible, returned: targeting.returned },
  );

  for (const row of targeting.contacts) {
    check(`row ${row.contactId} gate_2`, row.gateStatus === "gate_2", "gate_2", row.gateStatus);
    check(`row ${row.contactId} campaign inactive`, row.campaignActive === false, false, true);
  }

  const dbRows = await db.contact.findMany({
    where: { id: { in: targeting.contacts.map((c) => c.contactId) } },
    select: { id: true, mergedIntoId: true },
  });
  for (const r of dbRows) {
    check(`mergedIntoId null ${r.id}`, r.mergedIntoId === null, null, r.mergedIntoId);
  }

  const pick = targeting.contacts.slice(0, 3).map((c) => c.contactId);
  check("have 3 contacts for assignment", pick.length === 3, 3, pick.length);

  const assign = await assignToCampaign({
    contactIds: pick,
    campaignLabel: "Test Campaign",
    actorUserId: dataOwner.id,
  });
  check("assignToCampaign assigned=3", assign.assigned === 3, 3, assign.assigned);
  check("assignToCampaign skipped=0", assign.skipped === 0, 0, assign.skipped);

  for (const id of pick) {
    const c = await db.contact.findUnique({
      where: { id },
      select: { campaignActive: true, writeSource: true },
    });
    check(`contact ${id} campaignActive after assign`, c?.campaignActive === true, true, c?.campaignActive);
    check(`contact ${id} writeSource ai_sdr`, c?.writeSource === "ai_sdr_platform", "ai_sdr_platform", c?.writeSource);
  }

  const bounceId = pick[0]!;
  const stopId = pick[1]!;
  const positiveId = pick[2]!;

  const bounceResult = await registerBounceEvent({
    contactId: bounceId,
    bounceType: "hard",
    bounceReason: "Mailbox not found",
    actorUserId: dataOwner.id,
  });
  check("bounce gateDowngraded", bounceResult.gateDowngraded === true, true, bounceResult.gateDowngraded);
  check("bounce quarantined", bounceResult.quarantined === true, true, bounceResult.quarantined);
  check(
    "bounce campaignDeactivated",
    bounceResult.campaignDeactivated === true,
    true,
    bounceResult.campaignDeactivated,
  );

  const bounced = await db.contact.findUnique({
    where: { id: bounceId },
    select: { gateStatus: true, quarantineReason: true, campaignActive: true },
  });
  check("bounced contact gate_1", bounced?.gateStatus === "gate_1", "gate_1", bounced?.gateStatus);
  check("bounced contact quarantineReason bounce", bounced?.quarantineReason === "bounce", "bounce", bounced?.quarantineReason);
  check("bounced contact campaign inactive", bounced?.campaignActive === false, false, bounced?.campaignActive);

  const ver = await db.verification.findFirst({
    where: { contactId: bounceId, provider: "ai_sdr_platform" },
    orderBy: { createdAt: "desc" },
  });
  check("bounce verification status invalid", ver?.status === "invalid", "invalid", ver?.status);

  const qlog = await db.quarantineLog.findFirst({
    where: { contactId: bounceId, reasonCode: "bounce" },
    orderBy: { createdAt: "desc" },
  });
  check("quarantine log bounce exists", Boolean(qlog));

  const ghist = await db.gateStatusHistory.findFirst({
    where: { contactId: bounceId, toGate: "gate_1" },
    orderBy: { createdAt: "desc" },
  });
  check("gate history to gate_1", Boolean(ghist), "row", ghist);

  const stopBefore = await db.suppression.count({
    where: { contactId: positiveId, reasonCode: "stop_reply" },
  });

  const stopResult = await registerReplyEvent({
    contactId: stopId,
    replyType: "stop",
    replyText: "Please remove me",
    actorUserId: dataOwner.id,
  });
  check("stop campaignDeactivated", stopResult.campaignDeactivated === true);
  check("stop suppressionCreated", stopResult.suppressionCreated === true);
  check("stop suppressionId", typeof stopResult.suppressionId === "string");

  const stopContact = await db.contact.findUnique({
    where: { id: stopId },
    select: { campaignActive: true },
  });
  check("stop contact campaign inactive", stopContact?.campaignActive === false);

  const sup = await db.suppression.findFirst({
    where: { id: stopResult.suppressionId! },
  });
  check("suppression isOptOut", sup?.isOptOut === true);
  check("suppression cooling indefinite", sup?.coolingPeriodIndefinite === true);
  check("suppression reasonCode stop_reply", sup?.reasonCode === "stop_reply");

  const posResult = await registerReplyEvent({
    contactId: positiveId,
    replyType: "positive",
    actorUserId: dataOwner.id,
  });
  check("positive campaignDeactivated", posResult.campaignDeactivated === true);
  check("positive suppressionCreated false", posResult.suppressionCreated === false);

  const stopAfter = await db.suppression.count({
    where: { contactId: positiveId, reasonCode: "stop_reply" },
  });
  check("no stop_reply suppression for positive contact", stopAfter === stopBefore, stopBefore, stopAfter);

  const targeting2 = await buildTargetingList({
    clientId: internal.id,
    gates: ["gate_2"],
    limit: 50,
  });
  const ids2 = new Set(targeting2.contacts.map((c) => c.contactId));
  check("STOP contact excluded from targeting", !ids2.has(stopId), false, ids2.has(stopId));

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
