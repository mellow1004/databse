/**
 * Shared provider interface types (Phase 4, Step 4.1).
 *
 * Every concrete provider in src/providers/ is a pure module: deterministic
 * output for a given input, no network calls, no DB writes. The Phase 4
 * waterfall + retry logic builds on top of these interfaces; mocking the
 * providers here lets the rest of the system exercise the real code paths
 * without external credentials or rate limits.
 */

// ============================================================
// Result types
// ============================================================

export type EmailVerificationStatus =
  | "valid"
  | "invalid"
  | "risky"
  | "unknown"
  | "catch_all"
  | "disposable";

export type EmailVerificationResult = {
  provider: string;
  status: EmailVerificationStatus;
  confidence: number; // 0.0 - 1.0
  rawResponse: Record<string, unknown>;
  creditsUsed: number;
};

export type PhoneVerificationStatus = "valid" | "invalid" | "risky" | "unknown";

export type PhoneVerificationResult = {
  provider: string;
  status: PhoneVerificationStatus;
  confidence: number;
  rawResponse: Record<string, unknown>;
  creditsUsed: number;
};

export type EnrichmentFields = {
  title?: string | null;
  seniority?: string | null;
  industry?: string | null;
  country?: string | null;
  headcountBand?: string | null;
  phone?: string | null;
};

export type EnrichmentResult = {
  provider: string;
  matched: boolean;
  fields: EnrichmentFields;
  confidence: number; // 0.0 - 1.0
  rawResponse: Record<string, unknown>;
  creditsUsed: number;
};

// ============================================================
// Provider interfaces
// ============================================================

export interface EmailVerifier {
  name: string;
  verifyEmail(email: string): Promise<EmailVerificationResult>;
}

export interface PhoneVerifier {
  name: string;
  verifyPhone(
    phone: string,
    country: string | null,
  ): Promise<PhoneVerificationResult>;
}

export type EnrichmentInput = {
  fullName: string;
  email: string | null;
  linkedinUrl: string | null;
  companyName: string | null;
  domain: string | null;
  country: string | null;
};

export interface Enricher {
  name: string;
  /** ISO 3166-1 alpha-2 codes this provider is primary-by-market for. */
  primaryMarkets: string[];
  enrichContact(input: EnrichmentInput): Promise<EnrichmentResult>;
}
