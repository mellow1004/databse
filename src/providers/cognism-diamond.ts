/**
 * Mock Cognism Diamond (phone-verification provider).
 *
 * Deterministic rules:
 *   - international format (leading "+" and at least 10 digits)  → valid,   conf 0.94
 *   - fewer than 8 digits                                        → invalid, conf 0.99
 *   - everything else                                            → unknown, conf 0.40
 *
 * creditsUsed: 5 per call — phone verification is the most expensive
 * provider tier in the waterfall.
 */

import { normalizePhone } from "@/lib/normalization";
import { hexHash } from "./_helpers";
import type { PhoneVerificationResult, PhoneVerifier } from "./types";

const PROVIDER = "cognism_diamond";

function fakeTransactionId(phone: string): string {
  return `cgd_${hexHash(phone).slice(0, 16)}`;
}

export const cognismDiamond: PhoneVerifier = {
  name: PROVIDER,

  async verifyPhone(
    phone: string,
    country: string | null,
  ): Promise<PhoneVerificationResult> {
    const canonical = normalizePhone(phone);

    if (!canonical) {
      return {
        provider: PROVIDER,
        status: "unknown",
        confidence: 0.0,
        rawResponse: { phone: phone ?? null, country, transaction_id: fakeTransactionId(String(phone)) },
        creditsUsed: 5,
      };
    }

    // normalizePhone keeps a leading "+" then digits only; we measure digit
    // count by stripping that prefix.
    const digitCount = canonical.replace(/^\+/, "").length;
    const hasInternationalPrefix = canonical.startsWith("+");

    const baseRaw: Record<string, unknown> = {
      phone: canonical,
      country,
      digit_count: digitCount,
      international: hasInternationalPrefix,
      transaction_id: fakeTransactionId(canonical),
    };

    if (digitCount < 8) {
      return {
        provider: PROVIDER,
        status: "invalid",
        confidence: 0.99,
        rawResponse: { ...baseRaw, reason: "too_few_digits" },
        creditsUsed: 5,
      };
    }

    if (hasInternationalPrefix && digitCount >= 10) {
      return {
        provider: PROVIDER,
        status: "valid",
        confidence: 0.94,
        rawResponse: { ...baseRaw, reason: "e164_format_ok" },
        creditsUsed: 5,
      };
    }

    return {
      provider: PROVIDER,
      status: "unknown",
      confidence: 0.4,
      rawResponse: { ...baseRaw, reason: "ambiguous_format" },
      creditsUsed: 5,
    };
  },
};
