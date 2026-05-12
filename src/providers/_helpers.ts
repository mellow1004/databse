/**
 * Deterministic hashing helpers for the mock provider modules.
 *
 * Every concrete provider needs to derive stable, pseudo-random behaviour
 * from the input (matched/unmatched, pick-from-list, fake transaction IDs,
 * synthetic phone suffixes, etc.) without true randomness — the same input
 * must always produce the same output, run after run.
 *
 * We reuse the canonicalising sha256Hash from @/lib/hashing so the digest
 * is unaffected by case/whitespace differences in the caller's input.
 */

import { sha256Hash } from "@/lib/hashing";

const ZERO_DIGEST = "0".repeat(64);

/** Full hex digest of input, or "00…" sentinel for empty/null input. */
export function hexHash(input: string | null | undefined): string {
  return sha256Hash(input) ?? ZERO_DIGEST;
}

/**
 * 32-bit non-negative integer derived from the first 8 hex chars of sha256(input).
 * Safe to use for arithmetic in pick-from-list / parity checks.
 */
export function hashInt(input: string | null | undefined): number {
  return parseInt(hexHash(input).slice(0, 8), 16);
}

/** Stable, deterministic pick from a non-empty list. */
export function pickFromList<T>(list: readonly T[], input: string | null | undefined): T {
  if (list.length === 0) throw new Error("pickFromList: empty list");
  return list[hashInt(input) % list.length]!;
}

/** True when sha256(input).slice(0,2) === "00" — roughly a 1/256 ≈ 0.39% rate. */
export function isCatchAllByHash(input: string | null | undefined): boolean {
  return hexHash(input).slice(0, 2) === "00";
}

/** Stable 6-digit numeric suffix used by synthetic phone numbers. */
export function syntheticPhoneSuffix(input: string | null | undefined): string {
  const n = hashInt(input) % 1_000_000;
  return n.toString().padStart(6, "0");
}
