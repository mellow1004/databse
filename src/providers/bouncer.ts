/**
 * Mock Bouncer (fallback email-verification provider).
 *
 * Same invalid/disposable rules as MillionVerifier, but stricter on
 * ambiguous cases and slightly lower confidence on "valid" — by design,
 * so the conflict-resolution logic (< 15% delta rule) has something to
 * arbitrate on overlapping verifications.
 *
 * Decision precedence:
 *   1. null/empty                                  → unknown,  conf 0.00
 *   2. .invalid TLD                                → invalid,  conf 0.99
 *   3. tombstoned demo domains                     → invalid,  conf 0.95
 *   4. disposable / temp-mail heuristic            → disposable, conf 0.95
 *   5. domain hash bucket "00" (MV would say catch_all)
 *      → risky, conf 0.65        ← Bouncer is stricter here
 *   6. otherwise                                   → valid,    conf 0.88
 *
 * creditsUsed: 1 per call.
 */

import { extractDomainFromEmail, normalizeEmail } from "@/lib/normalization";
import { hexHash, isCatchAllByHash } from "./_helpers";
import type { EmailVerificationResult, EmailVerifier } from "./types";

const PROVIDER = "bouncer";
const TOMBSTONED_DEMO_DOMAINS: ReadonlySet<string> = new Set([
  "example-demo.com",
  "orphan-demo.com",
]);

function fakeTransactionId(email: string): string {
  return `bnc_${hexHash(email).slice(0, 16)}`;
}

export const bouncer: EmailVerifier = {
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

    if (canonical.includes("disposable") || canonical.includes("temp-mail")) {
      return {
        provider: PROVIDER,
        status: "disposable",
        confidence: 0.95,
        rawResponse: { ...baseRaw, reason: "disposable_heuristic" },
        creditsUsed: 1,
      };
    }

    // Bouncer downgrades MV's "catch_all" to "risky" — same domain hash,
    // stricter verdict.
    if (domain && isCatchAllByHash(domain)) {
      return {
        provider: PROVIDER,
        status: "risky",
        confidence: 0.65,
        rawResponse: { ...baseRaw, reason: "catch_all_treated_as_risky" },
        creditsUsed: 1,
      };
    }

    return {
      provider: PROVIDER,
      status: "valid",
      confidence: 0.88,
      rawResponse: { ...baseRaw, reason: "smtp_ok" },
      creditsUsed: 1,
    };
  },
};
