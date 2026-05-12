/**
 * Pure unit-style exercise of every mock provider. No DB access, no network.
 *
 * Each provider gets:
 *   - happy-path + edge-case calls with deterministic inputs
 *   - assertions on status / confidence / creditsUsed / matched
 *   - cross-provider comparisons (MV vs Bouncer; Cognism vs Apollo)
 *
 * Run with:  npm run test:providers
 */
import {
  apollo,
  bouncer,
  cognism,
  cognismDiamond,
  millionVerifier,
  type EnrichmentInput,
} from "../src/providers";

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

const ENRICH_BASE: Omit<EnrichmentInput, "fullName" | "country"> = {
  email: null,
  linkedinUrl: null,
  companyName: "Demo Company",
  domain: "demo.test",
};

async function main() {
  console.log("Running mock-provider tests ...\n");

  // =====================================================
  // MillionVerifier
  // =====================================================
  console.log("--- MillionVerifier ---");

  const mvInvalid = await millionVerifier.verifyEmail("nope@something.invalid");
  check(
    "MV: nope@something.invalid → invalid",
    mvInvalid.status === "invalid" && mvInvalid.confidence === 0.99,
    { status: "invalid", confidence: 0.99 },
    { status: mvInvalid.status, confidence: mvInvalid.confidence },
  );

  const mvValid = await millionVerifier.verifyEmail("anna@northwave.io");
  check(
    "MV: anna@northwave.io → valid (0.92)",
    mvValid.status === "valid" && mvValid.confidence === 0.92,
    { status: "valid", confidence: 0.92 },
    { status: mvValid.status, confidence: mvValid.confidence },
  );

  const mvTombstoned = await millionVerifier.verifyEmail("deleted.john@example-demo.com");
  check(
    "MV: example-demo.com → invalid (tombstoned demo domain)",
    mvTombstoned.status === "invalid" && mvTombstoned.confidence === 0.95,
    { status: "invalid", confidence: 0.95 },
    { status: mvTombstoned.status, confidence: mvTombstoned.confidence },
  );

  const mvDisposable = await millionVerifier.verifyEmail("someone@disposablemail.com");
  check(
    "MV: disposablemail.com → disposable",
    mvDisposable.status === "disposable" && mvDisposable.confidence === 0.95,
    { status: "disposable", confidence: 0.95 },
    { status: mvDisposable.status, confidence: mvDisposable.confidence },
  );

  const mvUnknown = await millionVerifier.verifyEmail("");
  check(
    "MV: empty email → unknown (0.0)",
    mvUnknown.status === "unknown" && mvUnknown.confidence === 0.0,
    { status: "unknown", confidence: 0.0 },
    { status: mvUnknown.status, confidence: mvUnknown.confidence },
  );

  check(
    "MV: creditsUsed === 1 on every call",
    [mvInvalid, mvValid, mvTombstoned, mvDisposable, mvUnknown].every((r) => r.creditsUsed === 1),
    1,
    [mvInvalid, mvValid, mvTombstoned, mvDisposable, mvUnknown].map((r) => r.creditsUsed),
  );

  // =====================================================
  // Bouncer
  // =====================================================
  console.log("\n--- Bouncer ---");

  const bncValid = await bouncer.verifyEmail("anna@northwave.io");
  check(
    "Bouncer: anna@northwave.io → valid (0.88)",
    bncValid.status === "valid" && bncValid.confidence === 0.88,
    { status: "valid", confidence: 0.88 },
    { status: bncValid.status, confidence: bncValid.confidence },
  );

  check(
    "Bouncer confidence on valid email < MillionVerifier (deliberate < 15% delta)",
    bncValid.confidence < mvValid.confidence,
    `${bncValid.confidence} < ${mvValid.confidence}`,
    { bouncer: bncValid.confidence, mv: mvValid.confidence },
  );

  const bncInvalid = await bouncer.verifyEmail("nope@something.invalid");
  check(
    "Bouncer: .invalid TLD → invalid (0.99)",
    bncInvalid.status === "invalid" && bncInvalid.confidence === 0.99,
    { status: "invalid", confidence: 0.99 },
    { status: bncInvalid.status, confidence: bncInvalid.confidence },
  );

  // Find a catch-all-bucket domain so we can prove MV says catch_all while
  // Bouncer says risky for the same address. Brute-force scan until we land
  // on the 1/256 bucket.
  let catchAllDomain: string | null = null;
  for (let i = 0; i < 5000; i++) {
    const d = `test-catchall-${i}.example`;
    const r = await millionVerifier.verifyEmail(`probe@${d}`);
    if (r.status === "catch_all") {
      catchAllDomain = d;
      break;
    }
  }
  if (!catchAllDomain) {
    check("MV: at least one catch_all domain found in 5000 probes", false);
  } else {
    const mvCa = await millionVerifier.verifyEmail(`probe@${catchAllDomain}`);
    const bncCa = await bouncer.verifyEmail(`probe@${catchAllDomain}`);
    check(
      `MV: ${catchAllDomain} → catch_all (0.70)`,
      mvCa.status === "catch_all" && mvCa.confidence === 0.7,
      { status: "catch_all", confidence: 0.7 },
      { status: mvCa.status, confidence: mvCa.confidence },
    );
    check(
      "Bouncer downgrades MV catch_all → risky (0.65)",
      bncCa.status === "risky" && bncCa.confidence === 0.65,
      { status: "risky", confidence: 0.65 },
      { status: bncCa.status, confidence: bncCa.confidence },
    );
  }

  // =====================================================
  // Cognism + Apollo enrichers
  // =====================================================
  console.log("\n--- Cognism + Apollo ---");

  check(
    "Cognism primaryMarkets covers SE + GB",
    cognism.primaryMarkets.includes("SE") && cognism.primaryMarkets.includes("GB"),
    "includes SE,GB",
    cognism.primaryMarkets,
  );
  check(
    "Apollo primaryMarkets covers US + CA",
    apollo.primaryMarkets.includes("US") && apollo.primaryMarkets.includes("CA"),
    "includes US,CA",
    apollo.primaryMarkets,
  );

  // Fan out across a deterministic name population.
  const names = [
    "Anna Lindberg", "Oscar Berg", "Mei Tan", "James OConnor",
    "Sara Kowalski", "John Smith", "Maria Johansson", "Erik Nilsson",
    "Lars Andersson", "Karin Eriksson", "Fatima Haidari", "Luca Rossi",
  ];

  const cogResults = await Promise.all(
    names.map((n) => cognism.enrichContact({ ...ENRICH_BASE, fullName: n, country: "SE" })),
  );
  const apolloResults = await Promise.all(
    names.map((n) => apollo.enrichContact({ ...ENRICH_BASE, fullName: n, country: "SE" })),
  );

  const cogMatched = cogResults.filter((r) => r.matched).length;
  const apolloMatched = apolloResults.filter((r) => r.matched).length;
  console.log(`      Cognism matched ${cogMatched}/${names.length}`);
  console.log(`      Apollo  matched ${apolloMatched}/${names.length}`);

  check(
    "Cognism matches between 25% and 75% of inputs (≈ half)",
    cogMatched >= Math.ceil(names.length * 0.25) && cogMatched <= Math.floor(names.length * 0.75),
    `[${Math.ceil(names.length * 0.25)}, ${Math.floor(names.length * 0.75)}]`,
    cogMatched,
  );
  check(
    "Apollo matches between 25% and 75% of inputs (≈ half)",
    apolloMatched >= Math.ceil(names.length * 0.25) && apolloMatched <= Math.floor(names.length * 0.75),
    `[${Math.ceil(names.length * 0.25)}, ${Math.floor(names.length * 0.75)}]`,
    apolloMatched,
  );

  // Pick the first name matched by Cognism — verify title pool + creditsUsed.
  const firstCogMatch = cogResults.find((r) => r.matched);
  if (!firstCogMatch) {
    check("Cognism: at least one match for the test name set", false);
  } else {
    const COG_TITLES = ["VP Sales", "Head of Marketing", "Director of Product", "CTO", "Engineering Manager"];
    check(
      "Cognism matched title is from its curated pool",
      typeof firstCogMatch.fields.title === "string" && COG_TITLES.includes(firstCogMatch.fields.title!),
      `one of ${JSON.stringify(COG_TITLES)}`,
      firstCogMatch.fields.title,
    );
    check(
      "Cognism creditsUsed === 3 on a match",
      firstCogMatch.creditsUsed === 3,
      3,
      firstCogMatch.creditsUsed,
    );
  }

  const firstCogMiss = cogResults.find((r) => !r.matched);
  if (firstCogMiss) {
    check(
      "Cognism creditsUsed === 1 on a miss",
      firstCogMiss.creditsUsed === 1,
      1,
      firstCogMiss.creditsUsed,
    );
  }

  const firstApolloMatch = apolloResults.find((r) => r.matched);
  if (!firstApolloMatch) {
    check("Apollo: at least one match for the test name set", false);
  } else {
    const APOLLO_TITLES = [
      "Senior Account Executive",
      "Solutions Architect",
      "Product Marketing Manager",
      "Sales Director",
      "Head of Customer Success",
    ];
    check(
      "Apollo matched title is from its curated pool",
      typeof firstApolloMatch.fields.title === "string" && APOLLO_TITLES.includes(firstApolloMatch.fields.title!),
      `one of ${JSON.stringify(APOLLO_TITLES)}`,
      firstApolloMatch.fields.title,
    );
    check(
      "Apollo creditsUsed === 3 on a match",
      firstApolloMatch.creditsUsed === 3,
      3,
      firstApolloMatch.creditsUsed,
    );
  }

  // Cognism: same name, SE vs US — primary-market vs out-of-market confidence.
  const seName = cogResults.find((r) => r.matched)?.rawResponse.query as
    | { fullName: string }
    | undefined;
  if (seName) {
    const cogSE = await cognism.enrichContact({ ...ENRICH_BASE, fullName: seName.fullName, country: "SE" });
    const cogUS = await cognism.enrichContact({ ...ENRICH_BASE, fullName: seName.fullName, country: "US" });
    check(
      "Cognism: SE confidence > US confidence for the same matched name",
      cogSE.confidence > cogUS.confidence,
      `${cogSE.confidence} > ${cogUS.confidence}`,
      { se: cogSE.confidence, us: cogUS.confidence },
    );
    check(
      "Cognism: SE → 0.91 (primary), US → 0.78 (secondary)",
      cogSE.confidence === 0.91 && cogUS.confidence === 0.78,
      { se: 0.91, us: 0.78 },
      { se: cogSE.confidence, us: cogUS.confidence },
    );
  }

  // Conflict scenario — find a name matched by BOTH providers and assert
  // their fabricated titles differ (the whole point of having two providers).
  let bothMatchName: string | null = null;
  for (let i = 0; i < names.length; i++) {
    if (cogResults[i]!.matched && apolloResults[i]!.matched) {
      bothMatchName = names[i]!;
      break;
    }
  }
  if (!bothMatchName) {
    check("Conflict: at least one name in the population matched by both", false);
  } else {
    const idx = names.indexOf(bothMatchName);
    const cogTitle = cogResults[idx]!.fields.title;
    const apolloTitle = apolloResults[idx]!.fields.title;
    console.log(`      Conflict pair on "${bothMatchName}": cognism="${cogTitle}" vs apollo="${apolloTitle}"`);
    check(
      `Conflict: cognism vs apollo titles differ for "${bothMatchName}"`,
      typeof cogTitle === "string" && typeof apolloTitle === "string" && cogTitle !== apolloTitle,
      "different titles",
      { cognism: cogTitle, apollo: apolloTitle },
    );
  }

  // =====================================================
  // Cognism Diamond (phone verification)
  // =====================================================
  console.log("\n--- Cognism Diamond ---");

  const phValid = await cognismDiamond.verifyPhone("+46701234001", "SE");
  check(
    "Phone: +46701234001 → valid (0.94)",
    phValid.status === "valid" && phValid.confidence === 0.94,
    { status: "valid", confidence: 0.94 },
    { status: phValid.status, confidence: phValid.confidence },
  );

  const phInvalid = await cognismDiamond.verifyPhone("12345", null);
  check(
    "Phone: 12345 → invalid (0.99) — too few digits",
    phInvalid.status === "invalid" && phInvalid.confidence === 0.99,
    { status: "invalid", confidence: 0.99 },
    { status: phInvalid.status, confidence: phInvalid.confidence },
  );

  const phAmbiguous = await cognismDiamond.verifyPhone("0701234567", "SE"); // 10 digits, no '+'
  check(
    "Phone: 0701234567 → unknown (0.40) — ambiguous format",
    phAmbiguous.status === "unknown" && phAmbiguous.confidence === 0.4,
    { status: "unknown", confidence: 0.4 },
    { status: phAmbiguous.status, confidence: phAmbiguous.confidence },
  );

  check(
    "Phone: creditsUsed === 5 on every call",
    [phValid, phInvalid, phAmbiguous].every((r) => r.creditsUsed === 5),
    5,
    [phValid, phInvalid, phAmbiguous].map((r) => r.creditsUsed),
  );

  // =====================================================
  // Summary
  // =====================================================
  console.log("");
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
