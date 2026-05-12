/**
 * End-to-end exercise of the identity resolvers against the live dev.db.
 *
 * Uses fixed test identifiers (TEST_DOMAIN, TEST_LINKEDIN) so the script is
 * fully idempotent — re-running it cleans up its own residue first, then
 * verifies that the second find-or-create call returns the same ids the
 * first one did.
 *
 * Run with:  npm run test:identity
 */
import { db } from "../src/lib/db";
import {
  resolveCompany,
  resolvePerson,
  resolveContact,
} from "../src/services/identity";

const TEST_DOMAIN = "test-resolver-newco.example";
const TEST_LINKEDIN = "linkedin.com/in/test-resolver-newperson";

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
 * Remove anything previous runs of this script may have left behind.
 * Deletion order: contact rows first (FK referrers), then domain alias rows
 * pointing at the test company, then the test company / persons themselves.
 */
async function cleanup(clientId: string) {
  const testCompany = await db.company.findUnique({
    where: { clientId_rootDomain: { clientId, rootDomain: TEST_DOMAIN } },
    select: { id: true },
  });
  const testPerson = await db.person.findUnique({
    where: { clientId_linkedinUrl: { clientId, linkedinUrl: TEST_LINKEDIN } },
    select: { id: true },
  });

  if (testCompany || testPerson) {
    await db.contact.deleteMany({
      where: {
        clientId,
        OR: [
          testCompany ? { companyId: testCompany.id } : { id: "__never__" },
          testPerson ? { personId: testPerson.id } : { id: "__never__" },
        ],
      },
    });
  }

  if (testCompany) {
    await db.domainAlias.deleteMany({ where: { companyId: testCompany.id } });
    await db.company.delete({ where: { id: testCompany.id } });
  }
  if (testPerson) {
    await db.person.delete({ where: { id: testPerson.id } });
  }
}

async function main() {
  const client = await db.client.findFirst({
    where: { name: "Brightvision Internal" },
    select: { id: true },
  });
  if (!client) {
    throw new Error("Seeded 'Brightvision Internal' client not found — run npm run db:seed first.");
  }

  await cleanup(client.id);

  // ----------------------------------------------------------------------
  // resolveCompany
  // ----------------------------------------------------------------------

  // Test 1 — existing seeded domain
  const seededCompany = await db.company.findFirst({
    where: { clientId: client.id, mergedIntoId: null },
    select: { id: true, rootDomain: true },
  });
  if (!seededCompany) throw new Error("No seeded companies in Brightvision Internal.");
  const r1 = await resolveCompany(
    client.id,
    seededCompany.rootDomain,
    "ignored legal name",
    "DE",
  );
  check("resolveCompany existing seeded → wasCreated=false", r1.wasCreated === false);
  check(
    "resolveCompany existing seeded → returns same id",
    r1.companyId === seededCompany.id,
    seededCompany.id,
    r1.companyId,
  );

  // Test 2 — domain alias resolves to the canonical company
  const alias = await db.domainAlias.findFirst({
    where: { clientId: client.id },
    select: { aliasDomain: true, companyId: true },
  });
  if (!alias) throw new Error("No seeded domain aliases in Brightvision Internal.");
  const r2 = await resolveCompany(client.id, alias.aliasDomain, null, null);
  check(
    "resolveCompany domain alias → returns canonical companyId",
    r2.companyId === alias.companyId,
    alias.companyId,
    r2.companyId,
  );
  check("resolveCompany domain alias → wasCreated=false", r2.wasCreated === false);

  // Test 3 — brand-new domain creates, second call returns same row
  const r3a = await resolveCompany(client.id, TEST_DOMAIN, "Test Resolver Newco", "SE");
  check("resolveCompany new domain → wasCreated=true", r3a.wasCreated === true);
  const r3b = await resolveCompany(client.id, TEST_DOMAIN, null, null);
  check(
    "resolveCompany re-run → returns same companyId",
    r3b.companyId === r3a.companyId,
    r3a.companyId,
    r3b.companyId,
  );
  check("resolveCompany re-run → wasCreated=false", r3b.wasCreated === false);

  // Sanity: the created Company has the right shape
  const createdCompany = await db.company.findUnique({
    where: { id: r3a.companyId },
    select: { rootDomain: true, legalName: true, country: true },
  });
  check(
    "resolveCompany new domain → row has normalised domain + legalName + country",
    createdCompany?.rootDomain === TEST_DOMAIN &&
      createdCompany?.legalName === "Test Resolver Newco" &&
      createdCompany?.country === "SE",
    { rootDomain: TEST_DOMAIN, legalName: "Test Resolver Newco", country: "SE" },
    createdCompany,
  );

  // ----------------------------------------------------------------------
  // resolvePerson
  // ----------------------------------------------------------------------

  // Test 4 — existing seeded linkedinUrl, but spelled differently
  const seededPerson = await db.person.findFirst({
    where: { clientId: client.id, linkedinUrl: { not: null } },
    select: { id: true, linkedinUrl: true },
  });
  if (!seededPerson?.linkedinUrl) throw new Error("No seeded persons with linkedinUrl found.");
  // Round-trip through a noisy form: uppercase host + https + www + trailing slash
  const noisyLinkedin = `https://www.${seededPerson.linkedinUrl.replace(/^linkedin\.com/, "LINKEDIN.com")}/`;
  const r4 = await resolvePerson(
    client.id,
    noisyLinkedin,
    null,
    null,
    "ignored full name",
    null,
    null,
  );
  check("resolvePerson noisy linkedinUrl → wasCreated=false", r4.wasCreated === false);
  check(
    "resolvePerson noisy linkedinUrl → returns same personId",
    r4.personId === seededPerson.id,
    seededPerson.id,
    r4.personId,
  );

  // Test 5 — brand-new identity creates, second call returns same row
  const r5a = await resolvePerson(
    client.id,
    TEST_LINKEDIN,
    "new.identity@test-resolver.example",
    null,
    "New Identity",
    "New",
    "Identity",
  );
  check("resolvePerson new identity → wasCreated=true", r5a.wasCreated === true);
  const r5b = await resolvePerson(
    client.id,
    TEST_LINKEDIN,
    null,
    null,
    "ignored",
    null,
    null,
  );
  check(
    "resolvePerson re-run → returns same personId",
    r5b.personId === r5a.personId,
    r5a.personId,
    r5b.personId,
  );
  check("resolvePerson re-run → wasCreated=false", r5b.wasCreated === false);

  // ----------------------------------------------------------------------
  // resolveContact
  // ----------------------------------------------------------------------

  // Test 6 — pair that already has a contact in the seed
  const seededContact = await db.contact.findFirst({
    where: { clientId: client.id, mergedIntoId: null },
    select: { id: true, personId: true, companyId: true },
  });
  if (!seededContact) throw new Error("No seeded contacts in Brightvision Internal.");
  const r6 = await resolveContact(
    client.id,
    seededContact.personId,
    seededContact.companyId,
    { email: null, phone: null, title: null },
  );
  check("resolveContact existing pair → wasCreated=false", r6.wasCreated === false);
  check(
    "resolveContact existing pair → returns same contactId",
    r6.contactId === seededContact.id,
    seededContact.id,
    r6.contactId,
  );

  // Test 7 — brand-new person+company pair (fresh entities from tests 3 & 5)
  const r7 = await resolveContact(client.id, r5a.personId, r3a.companyId, {
    email: "new.identity@test-resolver-newco.example",
    phone: null,
    title: "Test Title",
  });
  check("resolveContact new pair → wasCreated=true", r7.wasCreated === true);

  const createdContact = await db.contact.findUnique({
    where: { id: r7.contactId },
    select: {
      gateStatus: true,
      writeSource: true,
      email: true,
      title: true,
      mergedIntoId: true,
    },
  });
  check(
    "resolveContact new pair → gateStatus=gate_0, writeSource=intake, mergedIntoId=null",
    createdContact?.gateStatus === "gate_0" &&
      createdContact?.writeSource === "intake" &&
      createdContact?.mergedIntoId === null,
    { gateStatus: "gate_0", writeSource: "intake", mergedIntoId: null },
    createdContact,
  );
  check(
    "resolveContact new pair → candidate fields populated",
    createdContact?.email === "new.identity@test-resolver-newco.example" &&
      createdContact?.title === "Test Title",
    { email: "new.identity@test-resolver-newco.example", title: "Test Title" },
    createdContact,
  );

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
