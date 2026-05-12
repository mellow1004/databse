import { db } from "@/lib/db";
import {
  normalizeCountryCode,
  normalizeDomain,
  normalizeEmail,
  normalizeLinkedinUrl,
  normalizeName,
  normalizePhone,
} from "@/lib/normalization";

/**
 * Identity resolvers (PRD Section 6, Module 1 → Module 3).
 *
 * Pure find-or-create. No audit, no event log, no merge-history writes — the
 * promotion service (Step 3.3) layers those on top. The resolvers always
 * canonicalise their inputs via the existing normalize* helpers so the same
 * identifier coming in as "ANNA.LINDBERG@..." and "anna.lindberg@..." resolves
 * to the same record.
 *
 * Soft-merged records (mergedIntoId IS NOT NULL) are excluded from contact
 * lookups so a merged-away identity can never be matched again.
 */

// ----------------------------------------------------------------------------
// Company
// ----------------------------------------------------------------------------

/**
 * Find-or-create a Company by canonical domain.
 *
 * Lookup precedence:
 *   1. Company by (clientId, rootDomain)
 *   2. DomainAlias by (clientId, aliasDomain) → returns its canonical companyId
 *   3. Create a fresh Company
 *
 * Throws if candidateDomain is null/empty — promotion cannot identify a
 * company without one.
 */
export async function resolveCompany(
  clientId: string,
  candidateDomain: string | null,
  candidateCompanyName: string | null,
  candidateCountry: string | null,
): Promise<{ companyId: string; wasCreated: boolean }> {
  const domain = normalizeDomain(candidateDomain);
  if (!domain) {
    throw new Error("resolveCompany requires a non-empty domain");
  }

  // 1. Canonical root domain
  const existing = await db.company.findUnique({
    where: { clientId_rootDomain: { clientId, rootDomain: domain } },
    select: { id: true },
  });
  if (existing) {
    return { companyId: existing.id, wasCreated: false };
  }

  // 2. Domain alias
  const alias = await db.domainAlias.findUnique({
    where: { clientId_aliasDomain: { clientId, aliasDomain: domain } },
    select: { companyId: true },
  });
  if (alias) {
    return { companyId: alias.companyId, wasCreated: false };
  }

  // 3. Create
  const legalName = normalizeName(candidateCompanyName) ?? domain;
  const country = normalizeCountryCode(candidateCountry);
  const created = await db.company.create({
    data: {
      clientId,
      rootDomain: domain,
      legalName,
      country,
    },
    select: { id: true },
  });
  return { companyId: created.id, wasCreated: true };
}

// ----------------------------------------------------------------------------
// Person
// ----------------------------------------------------------------------------

/**
 * Find-or-create a Person.
 *
 * Lookup precedence (skipping any input that normalises to null/empty):
 *   1. linkedinUrl  → @@unique([clientId, linkedinUrl])
 *   2. primaryEmail
 *   3. primaryPhone
 *
 * If no identifier hits, a new Person is created with whatever normalised
 * fields are available. `fullName` is required on Person, so callers must
 * provide one (intake derives it from first+last when no full_name column is
 * present).
 */
export async function resolvePerson(
  clientId: string,
  candidateLinkedinUrl: string | null,
  candidateEmail: string | null,
  candidatePhone: string | null,
  candidateFullName: string,
  candidateFirstName: string | null,
  candidateLastName: string | null,
): Promise<{ personId: string; wasCreated: boolean }> {
  const linkedinUrl = normalizeLinkedinUrl(candidateLinkedinUrl);
  const email = normalizeEmail(candidateEmail);
  const phone = normalizePhone(candidatePhone);

  // 1. By linkedinUrl
  if (linkedinUrl) {
    const byLinkedin = await db.person.findUnique({
      where: { clientId_linkedinUrl: { clientId, linkedinUrl } },
      select: { id: true },
    });
    if (byLinkedin) return { personId: byLinkedin.id, wasCreated: false };
  }

  // 2. By primaryEmail
  if (email) {
    const byEmail = await db.person.findFirst({
      where: { clientId, primaryEmail: email },
      select: { id: true },
    });
    if (byEmail) return { personId: byEmail.id, wasCreated: false };
  }

  // 3. By primaryPhone
  if (phone) {
    const byPhone = await db.person.findFirst({
      where: { clientId, primaryPhone: phone },
      select: { id: true },
    });
    if (byPhone) return { personId: byPhone.id, wasCreated: false };
  }

  // 4. Create
  const fullName = normalizeName(candidateFullName);
  if (!fullName) {
    throw new Error("resolvePerson requires a non-empty fullName for creation");
  }
  const created = await db.person.create({
    data: {
      clientId,
      linkedinUrl,
      primaryEmail: email,
      primaryPhone: phone,
      fullName,
      firstName: normalizeName(candidateFirstName),
      lastName: normalizeName(candidateLastName),
    },
    select: { id: true },
  });
  return { personId: created.id, wasCreated: true };
}

// ----------------------------------------------------------------------------
// Contact
// ----------------------------------------------------------------------------

/**
 * Find-or-create a Contact for (clientId, personId, companyId).
 *
 * Soft-merged contacts (mergedIntoId IS NOT NULL) are excluded so promotion
 * never reuses an identity that's been merged away. If multiple non-merged
 * matches exist (shouldn't, but defensive), the most-recently-updated wins.
 *
 * Newly-created contacts start at gate_0 with writeSource="intake".
 */
export async function resolveContact(
  clientId: string,
  personId: string,
  companyId: string,
  candidate: {
    email: string | null;
    phone: string | null;
    title: string | null;
  },
): Promise<{ contactId: string; wasCreated: boolean }> {
  const existing = await db.contact.findFirst({
    where: { clientId, personId, companyId, mergedIntoId: null },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (existing) {
    return { contactId: existing.id, wasCreated: false };
  }

  const email = normalizeEmail(candidate.email);
  const phone = normalizePhone(candidate.phone);
  const title = candidate.title ? candidate.title.trim() || null : null;

  const created = await db.contact.create({
    data: {
      clientId,
      personId,
      companyId,
      email,
      phone,
      title,
      gateStatus: "gate_0",
      writeSource: "intake",
    },
    select: { id: true },
  });
  return { contactId: created.id, wasCreated: true };
}
