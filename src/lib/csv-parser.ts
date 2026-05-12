import Papa from "papaparse";
import { z } from "zod";
import type { ParsedCsvRow, ParseResult } from "../types/intake";
import {
  extractDomainFromEmail,
  normalizeCountryCode,
  normalizeDomain,
  normalizeEmail,
  normalizeLinkedinUrl,
  normalizeName,
  normalizePhone,
} from "./normalization";

// ----------------------------------------------------------------------------
// Header → canonical field map. Keys are the *canonicalised* header form
// produced by canonicaliseHeader() below (lowercase, internal whitespace
// replaced with underscores), so the lookup is case-insensitive and tolerant
// of "Email Address" / "Email_Address" / "email address" variants.
// ----------------------------------------------------------------------------

const HEADER_ALIASES: Record<string, keyof ParsedCsvRow["candidate"]> = {
  // email
  email: "email",
  email_address: "email",
  work_email: "email",
  "e-mail": "email",
  // linkedinUrl
  linkedin: "linkedinUrl",
  linkedin_url: "linkedinUrl",
  linkedin_profile: "linkedinUrl",
  li_url: "linkedinUrl",
  // phone
  phone: "phone",
  mobile: "phone",
  phone_number: "phone",
  direct_phone: "phone",
  // fullName
  full_name: "fullName",
  name: "fullName",
  contact_name: "fullName",
  // firstName
  first_name: "firstName",
  firstname: "firstName",
  given_name: "firstName",
  // lastName
  last_name: "lastName",
  lastname: "lastName",
  surname: "lastName",
  family_name: "lastName",
  // title
  title: "title",
  job_title: "title",
  position: "title",
  role: "title",
  // companyName
  company: "companyName",
  company_name: "companyName",
  organization: "companyName",
  employer: "companyName",
  // domain
  domain: "domain",
  website: "domain",
  company_website: "domain",
  company_domain: "domain",
  // country
  country: "country",
  country_code: "country",
};

function canonicaliseHeader(header: string): string {
  return header.toLowerCase().trim().replace(/\s+/g, "_");
}

// ----------------------------------------------------------------------------
// Per-row validation. Errors are accumulated (no early-exit) so the user sees
// every problem with a row in a single pass.
// ----------------------------------------------------------------------------

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CandidateSchema = z
  .object({
    email: z.string().nullable(),
    linkedinUrl: z.string().nullable(),
    phone: z.string().nullable(),
    fullName: z.string().nullable(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    title: z.string().nullable(),
    companyName: z.string().nullable(),
    domain: z.string().nullable(),
    country: z.string().nullable(),
  })
  .superRefine((c, ctx) => {
    if (!c.email && !c.linkedinUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "missing identifier: need email or linkedinUrl",
        path: [],
      });
    }
    if (!c.fullName && !(c.firstName && c.lastName)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "missing name: need fullName or firstName+lastName",
        path: [],
      });
    }
    if (c.email && !EMAIL_REGEX.test(c.email)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "invalid email format",
        path: ["email"],
      });
    }
    if (c.country && !/^[A-Z]{2}$/.test(c.country)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "country must be ISO 3166-1 alpha-2",
        path: ["country"],
      });
    }
  });

function validateCandidate(candidate: ParsedCsvRow["candidate"]): string[] {
  const result = CandidateSchema.safeParse(candidate);
  if (result.success) return [];
  return result.error.issues.map((i) => i.message);
}

// ----------------------------------------------------------------------------
// Main entry point
// ----------------------------------------------------------------------------

export function parseCsv(csvText: string): ParseResult {
  // Early bail: completely empty input is unambiguous.
  if (!csvText || csvText.trim() === "") {
    return {
      totalRows: 0,
      validRows: 0,
      invalidRows: 0,
      rows: [],
      fileLevelErrors: ["csv has no data rows"],
    };
  }

  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  const originalHeaders: string[] = parsed.meta.fields ?? [];

  // Truly unparseable: no headers AND no data.
  if (originalHeaders.length === 0 && parsed.data.length === 0) {
    const firstError = parsed.errors[0]?.message ?? "unknown parse error";
    return {
      totalRows: 0,
      validRows: 0,
      invalidRows: 0,
      rows: [],
      fileLevelErrors: [`csv could not be parsed: ${firstError}`],
    };
  }

  // Header present but no data rows → treat as "no data rows".
  if (parsed.data.length === 0) {
    return {
      totalRows: 0,
      validRows: 0,
      invalidRows: 0,
      rows: [],
      fileLevelErrors: ["csv has no data rows"],
    };
  }

  // Build header → canonical field map by walking the headers we recognise.
  const headerToField = new Map<string, keyof ParsedCsvRow["candidate"]>();
  for (const h of originalHeaders) {
    const key = canonicaliseHeader(h);
    const field = HEADER_ALIASES[key];
    if (field) headerToField.set(h, field);
  }

  const fileLevelErrors: string[] = [];
  const recognisedFields = new Set(headerToField.values());
  if (!recognisedFields.has("email") && !recognisedFields.has("linkedinUrl")) {
    fileLevelErrors.push("csv must contain at least one of: email, linkedin_url");
  }

  // Build a row-by-row result.
  const rows: ParsedCsvRow[] = parsed.data.map((row, i) => {
    const rowNumber = i + 2; // header is row 1
    const rawValues: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      rawValues[k] = v ?? "";
    }

    // Pull values by canonical field
    const raw: Partial<Record<keyof ParsedCsvRow["candidate"], string | null>> = {};
    for (const [header, value] of Object.entries(row)) {
      const field = headerToField.get(header);
      if (field) raw[field] = value ?? null;
    }

    // Normalise each field with the appropriate utility.
    const email = normalizeEmail(raw.email);
    const linkedinUrl = normalizeLinkedinUrl(raw.linkedinUrl);
    const phone = normalizePhone(raw.phone);
    const firstName = normalizeName(raw.firstName);
    const lastName = normalizeName(raw.lastName);
    let fullName = normalizeName(raw.fullName);
    const title = normalizeName(raw.title);
    const companyName = normalizeName(raw.companyName);
    let domain = normalizeDomain(raw.domain);
    const country = normalizeCountryCode(raw.country);

    // Derived: domain from email when no explicit domain column was provided.
    if (!domain && email) {
      domain = extractDomainFromEmail(email);
    }
    // Derived: compose fullName from first + last when no full_name column was provided.
    if (!fullName && firstName && lastName) {
      fullName = `${firstName} ${lastName}`;
    }

    const candidate: ParsedCsvRow["candidate"] = {
      email,
      linkedinUrl,
      phone,
      fullName,
      firstName,
      lastName,
      title,
      companyName,
      domain,
      country,
    };

    return {
      rowNumber,
      rawValues,
      candidate,
      validationErrors: validateCandidate(candidate),
    };
  });

  const validRows = rows.filter((r) => r.validationErrors.length === 0).length;

  return {
    totalRows: rows.length,
    validRows,
    invalidRows: rows.length - validRows,
    rows,
    fileLevelErrors,
  };
}
