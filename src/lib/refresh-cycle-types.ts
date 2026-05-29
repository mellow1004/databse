/** Serializable shapes for refresh cycle UI (no DB imports). */

export type RefreshCycleResultJson = {
  refreshLogId: string;
  cycleNumber: number;
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
  contactsProcessed: number;
  verification: {
    succeeded: number;
    failed: number;
    creditsByProvider: Record<string, number>;
  };
  enrichment: {
    enriched: number;
    noMatch: number;
    skipped: number;
    failed: number;
    conflictsFlagged: number;
    creditsByProvider: Record<string, number>;
  };
  gates: {
    promoted: number;
    downgraded: number;
    unchanged: number;
    quarantined: number;
  };
  anonymisation: {
    candidatesIdentified: number;
    anonymised: number;
    skipped?: Array<{ contactId: string; reason: string }>;
  };
  costBreakdown: Array<{ provider: string; credits: number; eurCost: number }>;
  totalCostEur: number;
  errors?: Array<{ phase: string; message: string }>;
  pendingApprovalId?: string;
};

export type RefreshLogRow = {
  id: string;
  clientId: string;
  cycleNumber: number;
  startedAt: string;
  completedAt: string | null;
  status: string;
  recordsReVerified: number;
  recordsDowngraded: number;
  recordsAnonymised: number;
  costEstimate: number | null;
  durationSeconds: number;
  costBreakdown: Array<{ provider: string; credits: number; eurCost: number }>;
};
