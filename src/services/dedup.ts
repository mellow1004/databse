/**
 * Dedup detection engine (Phase 3, Step 3.5).
 *
 * Pure detection: scans master Contact/Company rows and returns candidate
 * pairs (survivor + mergedFrom) with a confidence + human-readable reason.
 * No DB writes — the review UI in Step 3.6 consumes this and merge happens
 * in Step 3.7.
 *
 * Detection rules (contacts, within one clientId, mergedIntoId IS NULL):
 *   R1 — Same canonical LinkedIn URL across different personIds.   conf 0.95
 *        Different persons sharing one LI URL means Person resolution
 *        failed at intake — strongest dedup signal we have.
 *   R2 — Same personId at same companyId on different contacts.    conf 0.90
 *        Same person should have at most one contact per company; two means
 *        a duplicated role record (covers LinkedIn-less persons too).
 *   R3 — Same normalized email across different personIds.         conf 0.85
 *        Email is a strong-but-not-canonical identity anchor.
 *   R4 — Same fullName at same companyId across different persons. conf 0.60
 *        Weak signal — name collisions are common, used as a tie-breaker.
 *
 * Detection rules (companies, within one clientId, mergedIntoId IS NULL):
 *   RA — Similar legalName (legal/business suffixes stripped) at different
 *        rootDomains.                                              conf 0.75
 *   RB — One company's rootDomain appears as another's domain alias.
 *        Defensive — shouldn't normally happen.                    conf 0.90
 *
 * A single pair can match multiple rules. We keep one candidate per pair
 * keyed by the canonically-ordered (id1, id2) tuple, retaining the
 * highest-confidence rule's reason.
 *
 * Survivor selection:
 *   - Contacts: most recent lastEnrichedAt (fall back to updatedAt).
 *   - Companies: more contacts attached; tie-break by older createdAt.
 *
 * Performance: in-memory scan after one fetch per table. Plenty for the
 * demo (~2k contacts, ~160 companies). Do not optimise prematurely.
 */

import { db } from "@/lib/db";
import {
  normalizeEmail,
  normalizeLinkedinUrl,
  normalizeName,
} from "@/lib/normalization";

// ============================================================
// Public types
// ============================================================

export type FieldComparison = {
  field: string;
  survivorValue: string | null;
  mergedFromValue: string | null;
  source?: string;
  verified?: string;
};

export type DedupCandidate = {
  type: "contact" | "company";
  clientId: string;
  survivorId: string;
  mergedFromId: string;
  confidence: number;
  matchReason: string;
  fieldComparison: FieldComparison[];
  entityIds?: {
    personId: string | null;
    contactId: string | null;
    companyId: string | null;
  };
};

// ============================================================
// Internal row shapes (subset of the full Prisma model we actually use)
// ============================================================

type ContactRow = {
  id: string;
  clientId: string;
  personId: string;
  companyId: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  seniority: string | null;
  gateStatus: string;
  lastVerifiedAt: Date | null;
  lastEnrichedAt: Date | null;
  updatedAt: Date;
  person: { id: string; fullName: string; linkedinUrl: string | null };
  company: { id: string; legalName: string };
};

type CompanyRow = {
  id: string;
  clientId: string;
  rootDomain: string;
  legalName: string;
  industry: string | null;
  country: string | null;
  headcountBand: string | null;
  parentCompanyId: string | null;
  createdAt: Date;
};

// ============================================================
// Helpers
// ============================================================

/**
 * Words we strip from the *end* of legalName during company-dedup normalisation.
 * Legal forms come first; common branding/business-type tails follow so that
 * "Acme Holdings" and "Acme Finance Ltd" both reduce to "acme". The stripping
 * is iterative and only operates on trailing tokens, so it never collapses
 * "Hane - Mueller" (no trailing match) into "hane" or "mueller".
 */
const COMPANY_NAME_SUFFIX_WORDS: ReadonlySet<string> = new Set([
  // Legal forms
  "inc", "incorporated", "llc", "ltd", "limited",
  "gmbh", "oy", "ab", "as", "aps", "bv", "nv",
  "corp", "corporation", "co", "company",
  "plc", "ag", "sa", "sas", "srl", "spa", "kk",
  // Business-form / branding tails
  "holdings", "holding", "group", "groupe",
  "international", "intl", "global",
  "partners", "ventures", "capital", "finance",
]);

function normalizeCompanyLegalName(input: string | null | undefined): string | null {
  if (input == null) return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/[.,&\-]/g, " ").replace(/\s+/g, " ").trim();
  const tokens = s.split(" ").filter(Boolean);
  while (
    tokens.length > 1 &&
    COMPANY_NAME_SUFFIX_WORDS.has(tokens[tokens.length - 1]!)
  ) {
    tokens.pop();
  }
  return tokens.length > 0 ? tokens.join(" ") : null;
}

function fmtDate(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** Canonical key for a pair of IDs, order-independent. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function pickContactSurvivor(
  a: ContactRow,
  b: ContactRow,
): { survivor: ContactRow; mergedFrom: ContactRow } {
  const ta = (a.lastEnrichedAt ?? a.updatedAt).getTime();
  const tb = (b.lastEnrichedAt ?? b.updatedAt).getTime();
  return ta >= tb ? { survivor: a, mergedFrom: b } : { survivor: b, mergedFrom: a };
}

function buildContactFieldComparison(
  survivor: ContactRow,
  mergedFrom: ContactRow,
): FieldComparison[] {
  return [
    { field: "email", survivorValue: survivor.email, mergedFromValue: mergedFrom.email },
    { field: "phone", survivorValue: survivor.phone, mergedFromValue: mergedFrom.phone },
    { field: "title", survivorValue: survivor.title, mergedFromValue: mergedFrom.title },
    { field: "seniority", survivorValue: survivor.seniority, mergedFromValue: mergedFrom.seniority },
    { field: "gateStatus", survivorValue: survivor.gateStatus, mergedFromValue: mergedFrom.gateStatus },
    { field: "linkedinUrl", survivorValue: survivor.person.linkedinUrl, mergedFromValue: mergedFrom.person.linkedinUrl },
    { field: "companyName", survivorValue: survivor.company.legalName, mergedFromValue: mergedFrom.company.legalName },
    { field: "lastVerifiedAt", survivorValue: fmtDate(survivor.lastVerifiedAt), mergedFromValue: fmtDate(mergedFrom.lastVerifiedAt) },
    { field: "lastEnrichedAt", survivorValue: fmtDate(survivor.lastEnrichedAt), mergedFromValue: fmtDate(mergedFrom.lastEnrichedAt) },
  ];
}

function buildCompanyFieldComparison(
  survivor: CompanyRow,
  mergedFrom: CompanyRow,
  contactCounts: Map<string, number>,
  aliasCounts: Map<string, number>,
): FieldComparison[] {
  return [
    { field: "rootDomain", survivorValue: survivor.rootDomain, mergedFromValue: mergedFrom.rootDomain },
    { field: "legalName", survivorValue: survivor.legalName, mergedFromValue: mergedFrom.legalName },
    { field: "industry", survivorValue: survivor.industry, mergedFromValue: mergedFrom.industry },
    { field: "country", survivorValue: survivor.country, mergedFromValue: mergedFrom.country },
    { field: "headcountBand", survivorValue: survivor.headcountBand, mergedFromValue: mergedFrom.headcountBand },
    { field: "parentCompanyId", survivorValue: survivor.parentCompanyId, mergedFromValue: mergedFrom.parentCompanyId },
    { field: "contactCount", survivorValue: String(contactCounts.get(survivor.id) ?? 0), mergedFromValue: String(contactCounts.get(mergedFrom.id) ?? 0) },
    { field: "aliasCount", survivorValue: String(aliasCounts.get(survivor.id) ?? 0), mergedFromValue: String(aliasCounts.get(mergedFrom.id) ?? 0) },
  ];
}

// ============================================================
// Contact duplicate detection
// ============================================================

export async function findContactDuplicates(clientId: string): Promise<DedupCandidate[]> {
  const contacts = (await db.contact.findMany({
    where: { clientId, mergedIntoId: null },
    include: {
      person: { select: { id: true, fullName: true, linkedinUrl: true } },
      company: { select: { id: true, legalName: true } },
    },
  })) as ContactRow[];

  // Bucket contacts by the four match signals.
  const byLinkedin = new Map<string, ContactRow[]>();
  const byPersonAndCompany = new Map<string, ContactRow[]>();
  const byEmail = new Map<string, ContactRow[]>();
  const byNameAndCompany = new Map<string, ContactRow[]>();

  for (const c of contacts) {
    const liUrl = normalizeLinkedinUrl(c.person.linkedinUrl);
    if (liUrl) pushTo(byLinkedin, liUrl, c);

    pushTo(byPersonAndCompany, `${c.personId}::${c.companyId}`, c);

    const email = normalizeEmail(c.email);
    if (email) pushTo(byEmail, email, c);

    const name = normalizeName(c.person.fullName)?.toLowerCase() ?? null;
    if (name) pushTo(byNameAndCompany, `${name}::${c.companyId}`, c);
  }

  /**
   * Per-pair accumulator: a pair can match multiple rules, but we only ever
   * surface the highest-confidence match in the result. `seen` lets the
   * caller skip lower-confidence rules entirely once a stronger one fires.
   */
  const accepted = new Map<string, DedupCandidate>();

  function emit(a: ContactRow, b: ContactRow, confidence: number, reason: string): void {
    if (a.id === b.id) return;
    const key = pairKey(a.id, b.id);
    const existing = accepted.get(key);
    if (existing && existing.confidence >= confidence) return;
    const { survivor, mergedFrom } = pickContactSurvivor(a, b);
    accepted.set(key, {
      type: "contact",
      clientId,
      survivorId: survivor.id,
      mergedFromId: mergedFrom.id,
      confidence,
      matchReason: reason,
      fieldComparison: buildContactFieldComparison(survivor, mergedFrom),
      entityIds: {
        personId: survivor.personId,
        contactId: survivor.id,
        companyId: survivor.companyId,
      },
    });
  }

  // R1: same canonical LinkedIn URL across DIFFERENT persons.
  for (const group of byLinkedin.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (group[i]!.personId === group[j]!.personId) continue; // legitimate multi-role
        emit(group[i]!, group[j]!, 0.95, "Same LinkedIn URL");
      }
    }
  }

  // R2: same personId at same companyId on different contacts.
  for (const group of byPersonAndCompany.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        emit(group[i]!, group[j]!, 0.9, "Same person + same company, different contact records");
      }
    }
  }

  // R3: same normalized email across DIFFERENT persons.
  for (const group of byEmail.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (group[i]!.personId === group[j]!.personId) continue;
        emit(group[i]!, group[j]!, 0.85, "Same email on different person records");
      }
    }
  }

  // R4: same fullName at same companyId across DIFFERENT persons.
  for (const group of byNameAndCompany.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (group[i]!.personId === group[j]!.personId) continue;
        emit(group[i]!, group[j]!, 0.6, "Same name at same company");
      }
    }
  }

  return [...accepted.values()].sort((a, b) => b.confidence - a.confidence);
}

// ============================================================
// Company duplicate detection
// ============================================================

export async function findCompanyDuplicates(clientId: string): Promise<DedupCandidate[]> {
  const [companies, contactGroups, aliasGroups, aliases] = await Promise.all([
    db.company.findMany({
      where: { clientId, mergedIntoId: null },
      select: {
        id: true, clientId: true, rootDomain: true, legalName: true,
        industry: true, country: true, headcountBand: true,
        parentCompanyId: true, createdAt: true,
      },
    }),
    db.contact.groupBy({
      by: ["companyId"],
      where: { clientId, mergedIntoId: null },
      _count: { _all: true },
    }),
    db.domainAlias.groupBy({
      by: ["companyId"],
      where: { clientId },
      _count: { _all: true },
    }),
    db.domainAlias.findMany({
      where: { clientId },
      select: { companyId: true, aliasDomain: true },
    }),
  ]);

  const companyRows = companies as CompanyRow[];

  const contactCountByCompany = new Map<string, number>();
  for (const r of contactGroups) contactCountByCompany.set(r.companyId, r._count._all);

  const aliasCountByCompany = new Map<string, number>();
  for (const r of aliasGroups) aliasCountByCompany.set(r.companyId, r._count._all);

  const aliasDomainToCompany = new Map<string, string>();
  for (const a of aliases) aliasDomainToCompany.set(a.aliasDomain, a.companyId);

  const companyById = new Map<string, CompanyRow>();
  for (const c of companyRows) companyById.set(c.id, c);

  // Bucket companies by normalised legal-name root.
  const byCoreName = new Map<string, CompanyRow[]>();
  for (const c of companyRows) {
    const core = normalizeCompanyLegalName(c.legalName);
    if (core) pushTo(byCoreName, core, c);
  }

  const accepted = new Map<string, DedupCandidate>();

  function pickCompanySurvivor(
    a: CompanyRow,
    b: CompanyRow,
  ): { survivor: CompanyRow; mergedFrom: CompanyRow } {
    const ca = contactCountByCompany.get(a.id) ?? 0;
    const cb = contactCountByCompany.get(b.id) ?? 0;
    if (ca !== cb) {
      return ca > cb ? { survivor: a, mergedFrom: b } : { survivor: b, mergedFrom: a };
    }
    return a.createdAt <= b.createdAt
      ? { survivor: a, mergedFrom: b }
      : { survivor: b, mergedFrom: a };
  }

  function emit(a: CompanyRow, b: CompanyRow, confidence: number, reason: string): void {
    if (a.id === b.id) return;
    if (a.rootDomain === b.rootDomain) return; // rule requires different domains
    const key = pairKey(a.id, b.id);
    const existing = accepted.get(key);
    if (existing && existing.confidence >= confidence) return;
    const { survivor, mergedFrom } = pickCompanySurvivor(a, b);
    accepted.set(key, {
      type: "company",
      clientId,
      survivorId: survivor.id,
      mergedFromId: mergedFrom.id,
      confidence,
      matchReason: reason,
      fieldComparison: buildCompanyFieldComparison(
        survivor,
        mergedFrom,
        contactCountByCompany,
        aliasCountByCompany,
      ),
      entityIds: {
        personId: null,
        contactId: null,
        companyId: survivor.id,
      },
    });
  }

  // RA: similar legalName at different rootDomains.
  for (const group of byCoreName.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        emit(group[i]!, group[j]!, 0.75, "Same legal name root, different domain");
      }
    }
  }

  // RB: domain alias collision — one company's rootDomain is another's alias.
  for (const c of companyRows) {
    const ownerId = aliasDomainToCompany.get(c.rootDomain);
    if (!ownerId || ownerId === c.id) continue;
    const owner = companyById.get(ownerId);
    if (owner) emit(c, owner, 0.9, "Domain alias collision");
  }

  return [...accepted.values()].sort((a, b) => b.confidence - a.confidence);
}

// ============================================================
// Combined entry point
// ============================================================

export async function findAllDuplicates(clientId: string): Promise<DedupCandidate[]> {
  const [contacts, companies] = await Promise.all([
    findContactDuplicates(clientId),
    findCompanyDuplicates(clientId),
  ]);
  return [...contacts, ...companies].sort((a, b) => b.confidence - a.confidence);
}
