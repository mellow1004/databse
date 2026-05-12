/**
 * Mock Cognism (primary enrichment provider for UK/Nordics/DACH).
 *
 * Deterministic. A given fullName always produces the same matched/unmatched
 * verdict, and matched contacts always receive the same fabricated title,
 * seniority, industry, country, headcount-band and phone.
 *
 * Match rule: hashInt(fullName) is even → matched, odd → unmatched.
 *
 * Confidence:
 *   - 0.91 when the input country is one of primaryMarkets
 *   - 0.78 outside primary markets (we still match, but trust the data less)
 *   - 0.00 when unmatched
 *
 * Credits: 3 per matched call, 1 per unmatched (a "no-hit" still costs).
 */

import { normalizeCountryCode, normalizeDomain, normalizeName } from "@/lib/normalization";
import { hashInt, pickFromList, syntheticPhoneSuffix } from "./_helpers";
import type {
  Enricher,
  EnrichmentInput,
  EnrichmentResult,
} from "./types";

const PROVIDER = "cognism";

const PRIMARY_MARKETS: readonly string[] = ["GB", "SE", "NO", "DK", "FI", "DE"];

const TITLES: readonly string[] = [
  "VP Sales",
  "Head of Marketing",
  "Director of Product",
  "CTO",
  "Engineering Manager",
];

const INDUSTRIES: readonly string[] = [
  "SaaS",
  "Fintech",
  "E-commerce",
  "Manufacturing",
  "Healthcare",
];

const HEADCOUNT_BANDS: readonly string[] = [
  "1-10",
  "11-50",
  "51-200",
  "201-1000",
  "1000+",
];

/**
 * Derive a Brightvision seniority bucket from the fabricated title.
 * Keeps mock output coherent with the schema's seniority enum.
 */
function seniorityFromTitle(title: string): string {
  if (/^VP\b/i.test(title)) return "vp";
  if (/^(Head of|Director)\b/i.test(title)) return "director";
  if (/^(CTO|CFO|CEO|COO|CMO|CRO)\b/i.test(title)) return "c_level";
  if (/Manager$/i.test(title)) return "manager";
  return "ic";
}

export const cognism: Enricher = {
  name: PROVIDER,
  primaryMarkets: [...PRIMARY_MARKETS],

  async enrichContact(input: EnrichmentInput): Promise<EnrichmentResult> {
    const canonicalName = normalizeName(input.fullName) ?? input.fullName;
    const matched = hashInt(canonicalName) % 2 === 0;

    if (!matched) {
      return {
        provider: PROVIDER,
        matched: false,
        fields: {
          title: null,
          seniority: null,
          industry: null,
          country: null,
          headcountBand: null,
          phone: null,
        },
        confidence: 0.0,
        rawResponse: {
          query: { fullName: canonicalName, domain: input.domain },
          match: "no_hit",
        },
        creditsUsed: 1,
      };
    }

    const title = pickFromList(TITLES, canonicalName);
    const seniority = seniorityFromTitle(title);
    const industry = pickFromList(INDUSTRIES, normalizeDomain(input.domain) ?? canonicalName);
    const country = normalizeCountryCode(input.country) ?? "GB";
    const headcountBand = pickFromList(HEADCOUNT_BANDS, input.companyName ?? canonicalName);
    const phone = `+44 20 7946 ${syntheticPhoneSuffix(canonicalName)}`;

    const confidence = PRIMARY_MARKETS.includes(country) ? 0.91 : 0.78;

    return {
      provider: PROVIDER,
      matched: true,
      fields: { title, seniority, industry, country, headcountBand, phone },
      confidence,
      rawResponse: {
        query: { fullName: canonicalName, domain: input.domain, country: input.country },
        match: "hit",
        cognism_id: `cog_${hashInt(canonicalName).toString(16)}`,
        market: country,
      },
      creditsUsed: 3,
    };
  },
};
