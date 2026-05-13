/**
 * Status badge colors for admin UI (P.3 convention).
 * Returns Tailwind classes for use with `<Badge className={getStatusVariant(s)} />`.
 */
const SLATE = "border-transparent bg-slate-100 text-slate-700";
const EMERALD = "border-transparent bg-emerald-100 text-emerald-800";
const BLUE = "border-transparent bg-blue-100 text-blue-800";
const VIOLET = "border-transparent bg-violet-100 text-violet-800";
const ROSE = "border-transparent bg-rose-100 text-rose-800";
const AMBER = "border-transparent bg-amber-100 text-amber-800";

export function getStatusVariant(status: string | null | undefined): string {
  const s = (status ?? "unknown").toLowerCase();

  if (
    s === "gate_0" ||
    s === "pending" ||
    s === "unknown" ||
    s === "uploaded" ||
    s === "parsing" ||
    s === "promoting" ||
    s === "no_match" ||
    s === "disposable" ||
    s === "catch_all"
  ) {
    return SLATE;
  }

  if (
    s === "gate_1" ||
    s === "valid" ||
    s === "accepted" ||
    s === "success" ||
    s === "pass" ||
    s === "active"
  ) {
    return EMERALD;
  }

  if (s === "released" || s === "reviewed") {
    return s === "reviewed" ? BLUE : SLATE;
  }

  if (s === "gate_2" || s === "completed" || s === "promoted" || s === "conflict_resolved") {
    return BLUE;
  }

  if (s === "gate_3") {
    return VIOLET;
  }

  if (
    s === "quarantined" ||
    s === "invalid" ||
    s === "rejected" ||
    s === "bounce" ||
    s === "failed" ||
    s === "fail" ||
    s === "error"
  ) {
    return ROSE;
  }

  if (s === "rolled_back") {
    return VIOLET;
  }

  if (
    s === "conflict_pending" ||
    s === "risky" ||
    s === "aging" ||
    s === "ready_for_review" ||
    s === "rate_limited"
  ) {
    return AMBER;
  }

  if (s === "quarantine" || s === "deleted") {
    return ROSE;
  }

  return SLATE;
}

/** Dedup confidence tier: ≥95% emerald, ≥85% blue, ≥75% amber, else slate. */
export function getConfidenceTierVariant(confidence01: number): string {
  const pct = confidence01 * 100;
  if (pct >= 95) return EMERALD;
  if (pct >= 85) return BLUE;
  if (pct >= 75) return AMBER;
  return SLATE;
}

export function getDedupTypeVariant(type: "contact" | "company"): string {
  return type === "contact" ? BLUE : VIOLET;
}

/** Suppression scope row badges (P.4). */
export function getSuppressionScopeVariant(scope: string): string {
  switch (scope) {
    case "global":
      return ROSE;
    case "client_level":
      return AMBER;
    case "domain_level":
      return VIOLET;
    default:
      return SLATE;
  }
}

/** Quarantine reason codes (P.4). */
export function getQuarantineReasonVariant(code: string): string {
  switch (code) {
    case "bounce":
      return ROSE;
    case "verification_failure":
      return AMBER;
    case "gdpr_request":
      return VIOLET;
    case "manual_flag":
    case "accuracy_failure":
      return SLATE;
    default:
      return SLATE;
  }
}

export function getQuarantineReviewStateVariant(state: string): string {
  switch (state) {
    case "pending":
      return AMBER;
    case "reviewed":
      return BLUE;
    case "released":
      return SLATE;
    default:
      return SLATE;
  }
}

export function getAccuracyAlertVariant(
  level: "ok" | "investigation" | "demotion",
): string {
  if (level === "ok") return EMERALD;
  if (level === "investigation") return AMBER;
  return ROSE;
}

export function getAccuracyRateTextClass(rate: number | null): string {
  if (rate === null) return "text-muted-foreground";
  if (rate >= 85) return "text-emerald-700";
  if (rate >= 75) return "text-amber-700";
  return "text-rose-700";
}
