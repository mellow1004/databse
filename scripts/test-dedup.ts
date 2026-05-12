/**
 * End-to-end exercise of the dedup detection engine against the live dev.db.
 *
 * Pure detection — no DB writes from the service itself. This script does a
 * minimal soft-archive round-trip (set mergedIntoId, re-detect, revert) to
 * prove the mergedIntoId IS NULL filter is honoured.
 *
 * Run with:  npm run test:dedup
 */
import { db } from "../src/lib/db";
import {
  findAllDuplicates,
  findCompanyDuplicates,
  findContactDuplicates,
  type DedupCandidate,
} from "../src/services/dedup";

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

function summarise(label: string, list: DedupCandidate[]) {
  console.log(`\n  ${label}: ${list.length} candidate(s)`);
  for (const c of list) {
    console.log(
      `    [${c.type}]  conf=${c.confidence.toFixed(2)}  reason="${c.matchReason}"  survivor=${c.survivorId.slice(0, 8)}  mergedFrom=${c.mergedFromId.slice(0, 8)}`,
    );
  }
}

async function main() {
  console.log("Running dedup detection tests against dev.db ...\n");

  // ---- Resolve test client IDs from the seed ----
  const [ctech, cfin, bvint] = await Promise.all([
    db.client.findFirst({ where: { name: "ClientCo Tech" }, select: { id: true } }),
    db.client.findFirst({ where: { name: "ClientCo Finance" }, select: { id: true } }),
    db.client.findFirst({ where: { name: "Brightvision Internal" }, select: { id: true } }),
  ]);
  if (!ctech || !cfin || !bvint) {
    console.error("Seed clients missing — run `npm run db:seed` first.");
    process.exit(1);
  }

  // =====================================================
  // 1. ClientCo Tech contact duplicates
  // =====================================================
  const ctechContactDups = await findContactDuplicates(ctech.id);
  summarise("ClientCo Tech contact duplicates", ctechContactDups);

  check(
    "ClientCo Tech: ≥ 5 contact-duplicate candidates",
    ctechContactDups.length >= 5,
    "≥ 5",
    ctechContactDups.length,
  );

  const ctechHighConf = ctechContactDups.filter((c) => c.confidence >= 0.9);
  check(
    "ClientCo Tech: ≥ 3 candidates at confidence ≥ 0.9",
    ctechHighConf.length >= 3,
    "≥ 3",
    ctechHighConf.length,
  );

  check(
    "ClientCo Tech: every candidate is a contact",
    ctechContactDups.every((c) => c.type === "contact"),
    "all type=contact",
    ctechContactDups.map((c) => c.type),
  );

  check(
    "ClientCo Tech: results sorted by confidence desc",
    ctechContactDups.every(
      (c, i) => i === 0 || c.confidence <= ctechContactDups[i - 1]!.confidence,
    ),
    true,
    ctechContactDups.map((c) => c.confidence),
  );

  // =====================================================
  // 2. ClientCo Finance company duplicates
  // =====================================================
  const cfinCompanyDups = await findCompanyDuplicates(cfin.id);
  summarise("ClientCo Finance company duplicates", cfinCompanyDups);

  check(
    "ClientCo Finance: ≥ 3 company-duplicate candidates",
    cfinCompanyDups.length >= 3,
    "≥ 3",
    cfinCompanyDups.length,
  );

  check(
    "ClientCo Finance: every candidate is a company",
    cfinCompanyDups.every((c) => c.type === "company"),
    "all type=company",
    cfinCompanyDups.map((c) => c.type),
  );

  // Spot-check that the three seeded base names appear in the surfaced legal names.
  const seenLegalNames = new Set(
    cfinCompanyDups.flatMap((c) =>
      c.fieldComparison
        .filter((f) => f.field === "legalName")
        .flatMap((f) => [f.survivorValue, f.mergedFromValue])
        .filter((v): v is string => typeof v === "string"),
    ),
  );
  for (const base of ["Acme", "Globex", "Initech"]) {
    check(
      `ClientCo Finance: legal-name family "${base}" surfaced`,
      [...seenLegalNames].some((n) => n.toLowerCase().startsWith(base.toLowerCase())),
      `at least one legal name starting with "${base}"`,
      [...seenLegalNames],
    );
  }

  // =====================================================
  // 3. Brightvision Internal findAllDuplicates does not throw
  // =====================================================
  let bvintAll: DedupCandidate[] = [];
  let threw = false;
  try {
    bvintAll = await findAllDuplicates(bvint.id);
  } catch (err) {
    threw = true;
    console.error("Brightvision Internal findAllDuplicates threw:", err);
  }
  check("Brightvision Internal: findAllDuplicates does not throw", !threw);
  check(
    "Brightvision Internal: findAllDuplicates returns ≥ 0 candidates",
    bvintAll.length >= 0,
    "≥ 0",
    bvintAll.length,
  );
  summarise("Brightvision Internal all duplicates", bvintAll);

  // =====================================================
  // 4. fieldComparison shape on every candidate
  // =====================================================
  const allCandidates = [
    ...ctechContactDups,
    ...cfinCompanyDups,
    ...bvintAll,
  ];
  check(
    "Every candidate has a non-empty fieldComparison",
    allCandidates.length > 0 && allCandidates.every((c) => c.fieldComparison.length > 0),
    "all non-empty",
    allCandidates.map((c) => c.fieldComparison.length),
  );
  check(
    "Every candidate has ≥ 3 fields in fieldComparison",
    allCandidates.every((c) => c.fieldComparison.length >= 3),
    "all ≥ 3",
    allCandidates.map((c) => c.fieldComparison.length),
  );

  // =====================================================
  // 5. mergedIntoId IS NULL filter — soft-archive round-trip
  // =====================================================
  // Pick one ClientCo Tech contact duplicate, soft-archive its mergedFrom side,
  // and verify it disappears from the next detection run. Then revert so the
  // test is idempotent.
  const sample = ctechContactDups[0];
  if (!sample) {
    check("Round-trip skipped — no ClientCo Tech contact duplicates to test against", false);
  } else {
    const archiveId = sample.mergedFromId;
    const survivorId = sample.survivorId;

    await db.contact.update({
      where: { id: archiveId },
      data: { mergedIntoId: survivorId },
    });

    try {
      const after = await findContactDuplicates(ctech.id);
      const stillReferenced = after.some(
        (c) => c.survivorId === archiveId || c.mergedFromId === archiveId,
      );
      check(
        "Soft-archived contact disappears from contact-duplicate results",
        !stillReferenced,
        "no candidate references archived id",
        after.filter(
          (c) => c.survivorId === archiveId || c.mergedFromId === archiveId,
        ),
      );

      const all = await findAllDuplicates(ctech.id);
      const stillReferencedAll = all.some(
        (c) => c.survivorId === archiveId || c.mergedFromId === archiveId,
      );
      check(
        "Soft-archived contact disappears from findAllDuplicates results",
        !stillReferencedAll,
        "no candidate references archived id",
        all.filter(
          (c) => c.survivorId === archiveId || c.mergedFromId === archiveId,
        ),
      );
    } finally {
      // Revert so the script is idempotent.
      await db.contact.update({
        where: { id: archiveId },
        data: { mergedIntoId: null },
      });
    }
  }

  // Cross-cutting: none of the surfaced candidates reference a row currently
  // soft-archived. (Defensive — should already hold via the where-clause.)
  const referencedContactIds = new Set<string>();
  const referencedCompanyIds = new Set<string>();
  for (const c of allCandidates) {
    if (c.type === "contact") {
      referencedContactIds.add(c.survivorId);
      referencedContactIds.add(c.mergedFromId);
    } else {
      referencedCompanyIds.add(c.survivorId);
      referencedCompanyIds.add(c.mergedFromId);
    }
  }
  const archivedContacts = referencedContactIds.size
    ? await db.contact.count({
        where: { id: { in: [...referencedContactIds] }, mergedIntoId: { not: null } },
      })
    : 0;
  const archivedCompanies = referencedCompanyIds.size
    ? await db.company.count({
        where: { id: { in: [...referencedCompanyIds] }, mergedIntoId: { not: null } },
      })
    : 0;
  check(
    "No referenced contact has mergedIntoId set",
    archivedContacts === 0,
    0,
    archivedContacts,
  );
  check(
    "No referenced company has mergedIntoId set",
    archivedCompanies === 0,
    0,
    archivedCompanies,
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
