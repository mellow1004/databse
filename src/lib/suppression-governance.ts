export function suppressionRequiresApproval(suppression: {
  scope: string;
  reasonCode: string;
  isOptOut: boolean;
}): { requiresApproval: boolean; requiresRegulatoryReview: boolean } {
  if (suppression.isOptOut) {
    return { requiresApproval: true, requiresRegulatoryReview: true };
  }
  if (
    suppression.scope === "global" ||
    suppression.scope === "domain_level" ||
    suppression.reasonCode === "legal_block"
  ) {
    return { requiresApproval: true, requiresRegulatoryReview: false };
  }
  return { requiresApproval: false, requiresRegulatoryReview: false };
}
