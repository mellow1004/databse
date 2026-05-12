/**
 * Manual-style assertion suite for the CSV parser. No test framework — each
 * scenario throws on failure and the runner prints PASS/FAIL with a summary.
 *
 * Run with:  npm run test:parser
 */
import assert from "node:assert/strict";
import { parseCsv } from "../src/lib/csv-parser";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS  ${name}`);
    passed += 1;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`FAIL  ${name}`);
    console.log(`      ${msg.split("\n").join("\n      ")}`);
    failed += 1;
  }
}

// ---------------------------------------------------------------------------
// 1. A 3-row CSV with all-valid data
// ---------------------------------------------------------------------------
test("3-row CSV: all valid, prints 3 valid / 0 invalid", () => {
  const csv = [
    "email,full_name,company",
    "john@acme.com,John Smith,Acme",
    "jane@globex.com,Jane Doe,Globex",
    "bob@initech.com,Bob Builder,Initech",
  ].join("\n");
  const r = parseCsv(csv);
  assert.equal(r.totalRows, 3, "totalRows");
  assert.equal(r.validRows, 3, "validRows");
  assert.equal(r.invalidRows, 0, "invalidRows");
  assert.equal(r.fileLevelErrors.length, 0, "no file-level errors");
  assert.equal(r.rows[0].candidate.companyName, "Acme");
});

// ---------------------------------------------------------------------------
// 2. Row missing both email and linkedinUrl
// ---------------------------------------------------------------------------
test("Row missing both email and linkedinUrl is flagged", () => {
  const csv = ["email,linkedin_url,full_name", ",,John No Identifier"].join("\n");
  const r = parseCsv(csv);
  assert.equal(r.totalRows, 1, "totalRows");
  assert.equal(r.invalidRows, 1, "invalidRows");
  const errs = r.rows[0].validationErrors;
  assert.ok(
    errs.some((e) => e.includes("missing identifier")),
    `expected 'missing identifier' error; got: ${JSON.stringify(errs)}`,
  );
});

// ---------------------------------------------------------------------------
// 3. Malformed email
// ---------------------------------------------------------------------------
test("Row with malformed email is flagged", () => {
  const csv = ["email,full_name", "not-an-email,John Tester"].join("\n");
  const r = parseCsv(csv);
  assert.equal(r.totalRows, 1, "totalRows");
  assert.equal(r.invalidRows, 1, "invalidRows");
  const errs = r.rows[0].validationErrors;
  assert.ok(
    errs.some((e) => e.includes("invalid email format")),
    `expected 'invalid email format' error; got: ${JSON.stringify(errs)}`,
  );
});

// ---------------------------------------------------------------------------
// 4. Email normalisation + derived domain
// ---------------------------------------------------------------------------
test("Email Anna.Larsson@Acme.com normalises and derives domain acme.com", () => {
  const csv = ["email,full_name", "Anna.Larsson@Acme.com,Anna Larsson"].join("\n");
  const r = parseCsv(csv);
  assert.equal(r.rows[0].candidate.email, "anna.larsson@acme.com");
  assert.equal(r.rows[0].candidate.domain, "acme.com");
  assert.equal(r.rows[0].validationErrors.length, 0, "row should be valid");
});

// ---------------------------------------------------------------------------
// 5. LinkedIn URL canonicalisation
// ---------------------------------------------------------------------------
test("LinkedIn URL https://www.linkedin.com/in/anna/ normalises to linkedin.com/in/anna", () => {
  const csv = [
    "linkedin_url,full_name",
    "https://www.linkedin.com/in/anna/,Anna Test",
  ].join("\n");
  const r = parseCsv(csv);
  assert.equal(r.rows[0].candidate.linkedinUrl, "linkedin.com/in/anna");
});

// ---------------------------------------------------------------------------
// 6. first_name + last_name composes fullName
// ---------------------------------------------------------------------------
test("first_name + last_name composes fullName", () => {
  const csv = ["email,first_name,last_name", "sven@test.com,Sven,Karlsson"].join("\n");
  const r = parseCsv(csv);
  assert.equal(r.rows[0].candidate.firstName, "Sven");
  assert.equal(r.rows[0].candidate.lastName, "Karlsson");
  assert.equal(r.rows[0].candidate.fullName, "Sven Karlsson");
  assert.equal(r.rows[0].validationErrors.length, 0, "row should be valid");
});

// ---------------------------------------------------------------------------
// 7. Empty CSV → file-level "no data rows"
// ---------------------------------------------------------------------------
test("Empty CSV produces fileLevelErrors with 'no data rows'", () => {
  const r = parseCsv("");
  assert.equal(r.totalRows, 0);
  assert.ok(
    r.fileLevelErrors.some((e) => e.includes("no data rows")),
    `expected 'no data rows' file-level error; got: ${JSON.stringify(r.fileLevelErrors)}`,
  );
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log("");
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
