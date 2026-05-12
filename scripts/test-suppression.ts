/**
 * End-to-end exercise of the suppression enforcement service.
 *
 * All test-created suppressions carry the same `reasonDetail` marker so the
 * script can clean them up at start (idempotent rerun).
 *
 * Test paths:
 *   1. Baseline targetable contact (no blockers).
 *   2. Global suppression by email — blocks for any client.
 *   3. Client-level suppression by domain — blocks for that client only.
 *   4. Domain-level suppression — blocks regardless of campaign client.
 *   5. Opt-out cooling period — indefinite blocks; future date blocks; past
 *      date (expired) does NOT block.
 *   6. Bulk + filter — 5 contacts, 3 targetable + 2 blocked → counts match.
 *   7. Soft-archive guard — mergedIntoId throws.
 *
 * Run with: npm run test:suppression
 */
import { db } from "../src/lib/db";
import {
  evaluateBulkSuppression,
  evaluateContactSuppression,
  filterTargetableContacts,
} from "../src/services/suppression";

const TEST_MARKER = "test-suppression-script-v1";

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
  await db.suppression.deleteMany({
    where: { reasonDetail: TEST_MARKER },
  });
}

type BaselineContact = {
  id: string;
  email: string | null;
  companyRootDomain: string;
};

async function pickBaselineContact(
  clientId: string,
  campaignClientId: string,
): Promise<BaselineContact> {
  // Walk candidates until we find one that the seeded policy doesn't already
  // block — keeps the rest of the assertions deterministic.
  const candidates = await db.contact.findMany({
    where: {
      clientId,
      mergedIntoId: null,
      email: { not: null },
      lifecycleStage: "active",
    },
    select: {
      id: true,
      email: true,
      company: { select: { rootDomain: true } },
    },
    take: 60,
  });
  for (const c of candidates) {
    const decision = await evaluateContactSuppression(c.id, campaignClientId);
    if (decision.targetable) {
      return {
        id: c.id,
        email: c.email,
        companyRootDomain: c.company.rootDomain,
      };
    }
  }
  throw new Error("could not find a baseline targetable contact in the seed");
}

async function insertTestSuppression(args: {
  scope: "global" | "client_level" | "domain_level";
  clientId?: string | null;
  contactId?: string | null;
  email?: string | null;
  domain?: string | null;
  reasonCode: string;
  ownerUserId: string;
  isOptOut?: boolean;
  coolingPeriodIndefinite?: boolean;
  reviewRequiredBefore?: Date | null;
}) {
  return db.suppression.create({
    data: {
      scope: args.scope,
      clientId: args.clientId ?? null,
      contactId: args.contactId ?? null,
      email: args.email ?? null,
      domain: args.domain ?? null,
      reasonCode: args.reasonCode,
      reasonDetail: TEST_MARKER,
      owner: args.ownerUserId,
      source: "manual",
      isOptOut: args.isOptOut ?? false,
      coolingPeriodIndefinite: args.coolingPeriodIndefinite ?? true,
      reviewRequiredBefore: args.reviewRequiredBefore ?? null,
    },
  });
}

async function main() {
  console.log("Running suppression service tests against dev.db ...\n");

  const [internal, tech, dataOwner] = await Promise.all([
    db.client.findFirst({ where: { name: "Brightvision Internal" } }),
    db.client.findFirst({ where: { name: "ClientCo Tech" } }),
    db.user.findFirst({ where: { role: "data_owner" } }),
  ]);
  if (!internal || !tech || !dataOwner) {
    console.error("Seed prerequisites missing — run `npm run db:seed` first.");
    process.exit(1);
  }

  await cleanup();

  // ===========================================================
  // PATH 1 — baseline targetable
  // ===========================================================
  console.log("--- Path 1: baseline targetable ---");
  const baseline = await pickBaselineContact(internal.id, internal.id);
  const base = await evaluateContactSuppression(baseline.id, internal.id);
  check("path1: targetable === true", base.targetable === true, true, base.targetable);
  check(
    "path1: blockingSuppressions is empty",
    base.blockingSuppressions.length === 0,
    0,
    base.blockingSuppressions.length,
  );

  // ===========================================================
  // PATH 2 — global suppression by email
  // ===========================================================
  console.log("\n--- Path 2: global suppression by email ---");
  const sGlobal = await insertTestSuppression({
    scope: "global",
    email: baseline.email!,
    reasonCode: "competitor",
    ownerUserId: dataOwner.id,
  });
  const d2Internal = await evaluateContactSuppression(baseline.id, internal.id);
  const d2Tech = await evaluateContactSuppression(baseline.id, tech.id);
  check(
    "path2: blocked for Brightvision Internal",
    !d2Internal.targetable && d2Internal.blockingSuppressions.some((b) => b.scope === "global"),
    "blocked global",
    d2Internal,
  );
  check(
    "path2: also blocked for ClientCo Tech (global crosses clients)",
    !d2Tech.targetable && d2Tech.blockingSuppressions.some((b) => b.scope === "global"),
    "blocked global",
    d2Tech,
  );
  await db.suppression.delete({ where: { id: sGlobal.id } });

  // ===========================================================
  // PATH 3 — client_level by domain
  // ===========================================================
  console.log("\n--- Path 3: client_level by domain ---");
  const sClient = await insertTestSuppression({
    scope: "client_level",
    clientId: internal.id,
    domain: baseline.companyRootDomain,
    reasonCode: "conflict_of_interest",
    ownerUserId: dataOwner.id,
  });
  const d3Internal = await evaluateContactSuppression(baseline.id, internal.id);
  const d3Tech = await evaluateContactSuppression(baseline.id, tech.id);
  check(
    "path3: blocked when campaigning for the suppression's client",
    !d3Internal.targetable && d3Internal.blockingSuppressions.some((b) => b.scope === "client_level"),
    "blocked client_level",
    d3Internal,
  );
  check(
    "path3: not blocked when campaigning for a different client",
    d3Tech.targetable === true,
    true,
    d3Tech,
  );
  await db.suppression.delete({ where: { id: sClient.id } });

  // ===========================================================
  // PATH 4 — domain_level (no clientId)
  // ===========================================================
  console.log("\n--- Path 4: domain_level — crosses clients ---");
  const sDomain = await insertTestSuppression({
    scope: "domain_level",
    domain: baseline.companyRootDomain,
    reasonCode: "legal_block",
    ownerUserId: dataOwner.id,
  });
  const d4Internal = await evaluateContactSuppression(baseline.id, internal.id);
  const d4Tech = await evaluateContactSuppression(baseline.id, tech.id);
  check(
    "path4: blocked when campaigning for Brightvision Internal",
    !d4Internal.targetable && d4Internal.blockingSuppressions.some((b) => b.scope === "domain_level"),
    "blocked domain_level",
    d4Internal,
  );
  check(
    "path4: also blocked when campaigning for ClientCo Tech",
    !d4Tech.targetable && d4Tech.blockingSuppressions.some((b) => b.scope === "domain_level"),
    "blocked domain_level",
    d4Tech,
  );
  await db.suppression.delete({ where: { id: sDomain.id } });

  // ===========================================================
  // PATH 5 — opt-out cooling period
  // ===========================================================
  console.log("\n--- Path 5: opt-out cooling period ---");

  // 5a: indefinite opt-out → always blocks
  const sOpt = await insertTestSuppression({
    scope: "global",
    email: baseline.email!,
    reasonCode: "opt_out",
    ownerUserId: dataOwner.id,
    isOptOut: true,
    coolingPeriodIndefinite: true,
  });
  const d5a = await evaluateContactSuppression(baseline.id, internal.id);
  check(
    "path5a: indefinite opt-out blocks",
    !d5a.targetable &&
      d5a.blockingSuppressions.some(
        (b) => b.isOptOut && b.coolingPeriodIndefinite,
      ),
    "blocked indefinite opt-out",
    d5a,
  );

  // 5b: switch to dated cooling, future date → still blocks
  const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await db.suppression.update({
    where: { id: sOpt.id },
    data: { coolingPeriodIndefinite: false, reviewRequiredBefore: futureDate },
  });
  const d5b = await evaluateContactSuppression(baseline.id, internal.id);
  check(
    "path5b: future-dated cooling still blocks",
    !d5b.targetable &&
      d5b.blockingSuppressions.some(
        (b) => b.isOptOut && b.reviewRequiredBefore !== null,
      ),
    "blocked dated cooling",
    d5b,
  );

  // 5c: past date → cooling expired, no longer blocks
  const pastDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await db.suppression.update({
    where: { id: sOpt.id },
    data: { reviewRequiredBefore: pastDate },
  });
  const d5c = await evaluateContactSuppression(baseline.id, internal.id);
  check(
    "path5c: expired cooling period does NOT block",
    d5c.targetable === true && d5c.blockingSuppressions.length === 0,
    "targetable",
    d5c,
  );
  await db.suppression.delete({ where: { id: sOpt.id } });

  // ===========================================================
  // PATH 6 — bulk + filter
  // ===========================================================
  console.log("\n--- Path 6: bulk + filter ---");
  // Find 4 additional baseline targetable contacts so we can build a 5-pool
  // (1 baseline + 4 more) and then block 2 of them.
  const extraCandidates = await db.contact.findMany({
    where: {
      clientId: internal.id,
      mergedIntoId: null,
      email: { not: null },
      id: { not: baseline.id },
    },
    select: { id: true, email: true, company: { select: { rootDomain: true } } },
    take: 60,
  });
  const extras: BaselineContact[] = [];
  for (const c of extraCandidates) {
    const d = await evaluateContactSuppression(c.id, internal.id);
    if (d.targetable) {
      extras.push({
        id: c.id,
        email: c.email,
        companyRootDomain: c.company.rootDomain,
      });
    }
    if (extras.length === 4) break;
  }
  check(
    "path6: setup found 4 additional targetable contacts",
    extras.length === 4,
    4,
    extras.length,
  );
  const pool = [baseline, ...extras]; // 5 total
  // Block extras[0] and extras[1] via global email suppressions.
  const blockA = await insertTestSuppression({
    scope: "global",
    email: extras[0]!.email!,
    reasonCode: "competitor",
    ownerUserId: dataOwner.id,
  });
  const blockB = await insertTestSuppression({
    scope: "global",
    email: extras[1]!.email!,
    reasonCode: "competitor",
    ownerUserId: dataOwner.id,
  });

  const ids = pool.map((c) => c.id);
  const bulk = await evaluateBulkSuppression(ids, internal.id);
  check("path6: bulk returned 5 entries", bulk.size === 5, 5, bulk.size);
  const blockedIds = ids.filter((id) => !bulk.get(id)!.targetable);
  check(
    "path6: exactly 2 contacts are blocked",
    blockedIds.length === 2,
    2,
    blockedIds.length,
  );
  check(
    "path6: the right 2 contacts are blocked",
    new Set(blockedIds).has(extras[0]!.id) && new Set(blockedIds).has(extras[1]!.id),
    [extras[0]!.id, extras[1]!.id],
    blockedIds,
  );

  const filtered = await filterTargetableContacts(ids, internal.id);
  check(
    "path6: filterTargetableContacts returns 3 ids",
    filtered.length === 3,
    3,
    filtered.length,
  );
  check(
    "path6: filtered ids exclude the blocked pair",
    !filtered.includes(extras[0]!.id) && !filtered.includes(extras[1]!.id),
    "no blocked ids",
    filtered,
  );

  await db.suppression.deleteMany({ where: { id: { in: [blockA.id, blockB.id] } } });

  // ===========================================================
  // PATH 7 — soft-archive guard
  // ===========================================================
  console.log("\n--- Path 7: soft-archive guard ---");
  // Use a different baseline contact as survivor so the FK is valid.
  const survivor = extras[2]!;
  const guinea = baseline.id;
  await db.contact.update({
    where: { id: guinea },
    data: { mergedIntoId: survivor.id },
  });
  let threw = false;
  let errMsg = "";
  try {
    await evaluateContactSuppression(guinea, internal.id);
  } catch (err) {
    threw = true;
    errMsg = err instanceof Error ? err.message : String(err);
  }
  check("path7: throws when contact is soft-archived", threw, "throws", { threw, errMsg });
  check(
    "path7: error message mentions soft-archive",
    /merged|archived/i.test(errMsg),
    "mentions merged/archived",
    errMsg,
  );
  await db.contact.update({
    where: { id: guinea },
    data: { mergedIntoId: null },
  });

  // ---- Final cleanup ----
  await cleanup();

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
