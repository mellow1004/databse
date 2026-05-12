/**
 * Mock MillionVerifier (primary email-verification provider).
 *
 * Deterministic — same input always returns the same result. Drop-in for the
 * real https://www.millionverifier.com HTTP API once we replace this module
 * with a real client in a later phase.
 *
 * Decision precedence (first match wins):
 *   1. null/empty                                  → unknown,    conf 0.00
 *   2. .invalid TLD                                → invalid,    conf 0.99
 *   3. tombstoned demo domains (example-demo.com,
 *      orphan-demo.com)                            → invalid,    conf 0.95
 *   4. contains "disposable" or "temp-mail"        → disposable, conf 0.95
 *   5. domain hash bucket "00" (≈ 0.4%)            → catch_all,  conf 0.70
 *   6. otherwise                                   → valid,      conf 0.92
 *
 * creditsUsed: 1 per call.
 */

import { extractDomainFromEmail, normalizeEmail } from "@/lib/normalization";
import { hashInt, hexHash, isCatchAllByHash } from "./_helpers";
import type { EmailVerificationResult, EmailVerifier } from "./types";

const PROVIDER = "millionverifier";
const TOMBSTONED_DEMO_DOMAINS: ReadonlySet<string> = new Set([
  "example-demo.com",
  "orphan-demo.com",
]);

function fakeTransactionId(email: string): string {
  return `mv_${hexHash(email).slice(0, 16)}`;
}

export const millionVerifier: EmailVerifier = {
  name: PROVIDER,

  async verifyEmail(email: string): Promise<EmailVerificationResult> {
    const canonical = normalizeEmail(email);

    if (!canonical) {
      return {
        provider: PROVIDER,
        status: "unknown",
        confidence: 0.0,
        rawResponse: { email: email ?? null, transaction_id: fakeTransactionId(String(email)) },
        creditsUsed: 1,
      };
    }

    const domain = extractDomainFromEmail(canonical);

    const baseRaw: Record<string, unknown> = {
      email: canonical,
      transaction_id: fakeTransactionId(canonical),
      checked_domain: domain,
    };

    // 1. Hard-invalid TLDs and dead demo domains.
    if (canonical.endsWith(".invalid")) {
      return {
        provider: PROVIDER,
        status: "invalid",
        confidence: 0.99,
        rawResponse: { ...baseRaw, reason: "invalid_tld" },
        creditsUsed: 1,
      };
    }

    if (domain && TOMBSTONED_DEMO_DOMAINS.has(domain)) {
      return {
        provider: PROVIDER,
        status: "invalid",
        confidence: 0.95,
        rawResponse: { ...baseRaw, reason: "tombstoned_demo_domain" },
        creditsUsed: 1,
      };
    }

    // 2. Disposable / temp inbox heuristics.
    if (canonical.includes("disposable") || canonical.includes("temp-mail")) {
      return {
        provider: PROVIDER,
        status: "disposable",
        confidence: 0.95,
        rawResponse: { ...baseRaw, reason: "disposable_heuristic" },
        creditsUsed: 1,
      };
    }

    // 3. Hash-derived catch-all bucket (~0.4% of domains).
    if (domain && isCatchAllByHash(domain)) {
      return {
        provider: PROVIDER,
        status: "catch_all",
        confidence: 0.7,
        rawResponse: { ...baseRaw, reason: "catch_all_domain", bucket: hashInt(domain) },
        creditsUsed: 1,
      };
    }

    // 4. Default-valid.
    return {
      provider: PROVIDER,
      status: "valid",
      confidence: 0.92,
      rawResponse: { ...baseRaw, reason: "smtp_ok" },
      creditsUsed: 1,
    };
  },
};
