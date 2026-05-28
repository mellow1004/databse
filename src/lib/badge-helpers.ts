/**
 * Status badge colors for admin UI (P.3 convention).
 * Returns Tailwind classes for use with `<Badge className={getStatusVariant(s)} />`.
 */
const SUCCESS = "border-emerald-200 bg-emerald-50 text-emerald-700";
const DANGER = "border-red-200 bg-red-50 text-red-700";
const WARNING = "border-amber-200 bg-amber-50 text-amber-700";
const INFO = "border-blue-200 bg-blue-50 text-blue-700";
const NEUTRAL = "border-slate-200 bg-slate-100 text-slate-600";
const SPECIAL = "border-violet-200 bg-violet-50 text-violet-700";

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
    return NEUTRAL;
  }

  if (
    s === "gate_2" ||
    s === "valid" ||
    s === "accepted" ||
    s === "released" ||
    s === "completed" ||
    s === "promoted"
  ) {
    return SUCCESS;
  }

  if (s === "gate_1") {
    return INFO;
  }

  if (
    s === "open" ||
    s === "in_progress" ||
    s === "awaiting_subject" ||
    s === "reviewed" ||
    s === "accepted_as_info" ||
    s === "accepted-as-info"
  ) {
    return INFO;
  }

  if (s === "released_historical") {
    return NEUTRAL;
  }

  if (s === "gate_3") {
    return SPECIAL;
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
    return DANGER;
  }

  if (s === "rolled_back") {
    return SPECIAL;
  }

  if (
    s === "conflict_pending" ||
    s === "request_pending" ||
    s === "risky" ||
    s === "aging" ||
    s === "ready_for_review" ||
    s === "rate_limited"
  ) {
    return WARNING;
  }

  if (s === "quarantine" || s === "deleted") {
    return DANGER;
  }

  return NEUTRAL;
}

/** Dedup confidence tier: ≥95% emerald, ≥85% blue, ≥75% amber, else slate. */
export function getConfidenceTierVariant(confidence01: number): string {
  const pct = confidence01 * 100;
  if (pct >= 95) return SUCCESS;
  if (pct >= 85) return INFO;
  if (pct >= 75) return WARNING;
  return NEUTRAL;
}

export function getDedupTypeVariant(type: "contact" | "company"): string {
  return type === "contact" ? INFO : SPECIAL;
}

/** Suppression scope row badges (P.4). */
export function getSuppressionScopeVariant(scope: string): string {
  switch (scope) {
    case "global":
      return DANGER;
    case "client_level":
      return WARNING;
    case "domain_level":
      return SPECIAL;
    default:
      return NEUTRAL;
  }
}

/** Quarantine reason codes (P.4). */
export function getQuarantineReasonVariant(code: string): string {
  switch (code) {
    case "bounce":
      return DANGER;
    case "verification_failure":
      return WARNING;
    case "gdpr_request":
      return SPECIAL;
    case "manual_flag":
    case "accuracy_failure":
      return NEUTRAL;
    default:
      return NEUTRAL;
  }
}

export function getQuarantineReviewStateVariant(state: string): string {
  switch (state) {
    case "pending":
      return WARNING;
    case "reviewed":
      return INFO;
    case "released":
      return SUCCESS;
    default:
      return NEUTRAL;
  }
}

export function getAccuracyAlertVariant(
  level: "ok" | "investigation" | "demotion" | "insufficient_data",
): string {
  if (level === "insufficient_data") return NEUTRAL;
  if (level === "ok") return SUCCESS;
  if (level === "investigation") return WARNING;
  return DANGER;
}

export function getAccuracyRateTextClass(rate: number | null): string {
  if (rate === null) return "text-muted-foreground";
  if (rate >= 85) return "text-emerald-700";
  if (rate >= 75) return "text-amber-700";
  return "text-red-700";
}
