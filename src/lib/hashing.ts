import { createHash } from "node:crypto";
import {
  normalizeEmail,
  normalizeLinkedinUrl,
  normalizePhone,
} from "./normalization";

/**
 * Identifier hashing for the tombstone table and any future hash-based lookups.
 * All wrappers canonicalise their input via the normalize* helpers first so the
 * same identifier always produces the same digest regardless of source-of-truth
 * formatting (case, whitespace, www., trailing slash, phone punctuation).
 */

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/// SHA-256 hex digest of the input string. Input is normalised (trim + lowercase) before hashing.
/// Returns null for empty/null input.
export function sha256Hash(input: string | null | undefined): string | null {
  if (input == null) return null;
  const trimmed = input.trim().toLowerCase();
  if (trimmed === "") return null;
  return sha256(trimmed);
}

export function hashEmail(email: string | null | undefined): string | null {
  const canonical = normalizeEmail(email);
  return canonical ? sha256(canonical) : null;
}

export function hashLinkedinUrl(url: string | null | undefined): string | null {
  const canonical = normalizeLinkedinUrl(url);
  return canonical ? sha256(canonical) : null;
}

export function hashPhone(phone: string | null | undefined): string | null {
  const canonical = normalizePhone(phone);
  return canonical ? sha256(canonical) : null;
}
