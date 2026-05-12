/**
 * Pure normalisation utilities used at intake (Phase 2) and by canonicalisation/dedup
 * (Phase 3). Every function is side-effect free and returns null for empty input
 * so callers can treat the absence of a value uniformly.
 */

/// Lowercase + trim. Returns null for empty/whitespace input.
export function normalizeEmail(input: string | null | undefined): string | null {
  if (input == null) return null;
  const trimmed = input.trim().toLowerCase();
  return trimmed === "" ? null : trimmed;
}

/// Lowercase, strip http(s)://, strip leading www., strip trailing slash.
/// Returns null for empty input. Used as the canonical LinkedIn URL key.
export function normalizeLinkedinUrl(input: string | null | undefined): string | null {
  if (input == null) return null;
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const stripped = trimmed
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
  return stripped === "" ? null : stripped;
}

/// Strip non-digit characters except leading +. Returns null for empty input.
export function normalizePhone(input: string | null | undefined): string | null {
  if (input == null) return null;
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits === "") return null;
  return hasPlus ? `+${digits}` : digits;
}

/// Extract domain from an email (everything after @). Returns null if no @ found.
export function extractDomainFromEmail(email: string | null | undefined): string | null {
  if (email == null) return null;
  const atIdx = email.indexOf("@");
  if (atIdx === -1) return null;
  const domain = email.slice(atIdx + 1).trim().toLowerCase();
  return domain === "" ? null : domain;
}

/// Lowercase + trim a domain. Strip leading "www." if present.
export function normalizeDomain(input: string | null | undefined): string | null {
  if (input == null) return null;
  const lowered = input.trim().toLowerCase();
  if (lowered === "") return null;
  const stripped = lowered.replace(/^www\./, "");
  return stripped === "" ? null : stripped;
}

/// Trim, then uppercase if exactly 2 letters. Returns null for empty input.
/// Note: full ISO validation against a country list comes later — this is just normalisation.
export function normalizeCountryCode(input: string | null | undefined): string | null {
  if (input == null) return null;
  const trimmed = input.trim();
  if (trimmed === "") return null;
  if (/^[a-zA-Z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
  return trimmed;
}

/// Trim + collapse internal whitespace.
export function normalizeName(input: string | null | undefined): string | null {
  if (input == null) return null;
  const collapsed = input.trim().replace(/\s+/g, " ");
  return collapsed === "" ? null : collapsed;
}
