/**
 * Mock provider registry. The waterfall orchestrator in later steps imports
 * these arrays directly so it can iterate providers in deterministic order
 * (primary first, fallback second).
 */

import { millionVerifier } from "./millionverifier";
import { bouncer } from "./bouncer";
import { cognism } from "./cognism";
import { apollo } from "./apollo";
import { cognismDiamond } from "./cognism-diamond";
import type { EmailVerifier, Enricher, PhoneVerifier } from "./types";

export const emailVerifiers: readonly EmailVerifier[] = [millionVerifier, bouncer];
export const phoneVerifiers: readonly PhoneVerifier[] = [cognismDiamond];
export const enrichers: readonly Enricher[] = [cognism, apollo];

export { millionVerifier, bouncer, cognism, apollo, cognismDiamond };
export type {
  EmailVerifier,
  EmailVerificationResult,
  EmailVerificationStatus,
  Enricher,
  EnrichmentFields,
  EnrichmentInput,
  EnrichmentResult,
  PhoneVerifier,
  PhoneVerificationResult,
  PhoneVerificationStatus,
} from "./types";
