/**
 * Mock Apollo (primary enrichment provider for North America).
 *
 * Same shape as Cognism, different deterministic content:
 *   - distinct primary markets and title/industry pools
 *   - North-American phone format
 *   - independent match rule (bit 1 of the hash instead of bit 0), so a
 *     given name can be matched by Cognism only, Apollo only, both, or
 *     neither — gives the waterfall + conflict-resolution code something
 *     interesting to chew on
 *
 * Confidence:
 *   - 0.93 when country is one of primaryMarkets
 *   - 0.74 outside primary markets
 *   - 0.00 when unmatched
 *
 * Credits: 3 per matched call, 1 per unmatched.
 */

import { normalizeCountryCode, normalizeDomain, normalizeName } from "@/lib/normalization";
import { hashInt, pickFromList, syntheticPhoneSuffix } from "./_helpers";
import type {
  Enricher,
  EnrichmentInput,
  EnrichmentResult,
} from "./types";

const PROVIDER = "apollo";

const PRIMARY_MARKETS: readonly string[] = ["US", "CA", "MX"];

const TITLES: readonly string[] = [
  "Senior Account Executive",
  "Solutions Architect",
  "Product Marketing Manager",
  "Sales Director",
  "Head of Customer Success",
];

const INDUSTRIES: readonly string[] = [
  "SaaS",
  "Cybersecurity",
  "Marketing Tech",
  "AI/ML",
  "Hardware",
];

const HEADCOUNT_BANDS: readonly string[] = [
  "1-10",
  "11-50",
  "51-200",
  "201-1000",
  "1000+",
];

function seniorityFromTitle(title: string): string {
  if (/^Senior\b/i.test(title)) return "ic";
  if (/^(Sales Director|Director)\b/i.test(title)) return "director";
  if (/^(VP|Head of)\b/i.test(title)) return "director";
  if (/^(CTO|CFO|CEO|COO|CMO|CRO)\b/i.test(title)) return "c_level";
  if (/Manager$/i.test(title)) return "manager";
  return "ic";
}

export const apollo: Enricher = {
  name: PROVIDER,
  primaryMarkets: [...PRIMARY_MARKETS],

  async enrichContact(input: EnrichmentInput): Promise<EnrichmentResult> {
    const canonicalName = normalizeName(input.fullName) ?? input.fullName;
    // Bit 1 of the hash — independent from Cognism's bit 0. Still ≈ 50% match
    // rate, but no longer correlated with Cognism's matched/unmatched.
    const matched = ((hashInt(canonicalName) >> 1) & 1) === 0;

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
    const country = normalizeCountryCode(input.country) ?? "US";
    const headcountBand = pickFromList(HEADCOUNT_BANDS, input.companyName ?? canonicalName);
    const phone = `+1 415 555 ${syntheticPhoneSuffix(canonicalName)}`;

    const confidence = PRIMARY_MARKETS.includes(country) ? 0.93 : 0.74;

    return {
      provider: PROVIDER,
      matched: true,
      fields: { title, seniority, industry, country, headcountBand, phone },
      confidence,
      rawResponse: {
        query: { fullName: canonicalName, domain: input.domain, country: input.country },
        match: "hit",
        apollo_id: `apl_${hashInt(canonicalName).toString(16)}`,
        market: country,
      },
      creditsUsed: 3,
    };
  },
};
