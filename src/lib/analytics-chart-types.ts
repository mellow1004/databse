export type GateDistributionRow = {
  gate: string;
  count: number;
  label: string;
};

export type ProviderTrendRow = {
  cycle: number;
  cognism: number | null;
  apollo: number | null;
};

export type VerificationDayRow = {
  day: string;
  dayLabel: string;
  valid: number;
  invalid: number;
  risky: number;
  unknown: number;
};

export type SuppressionGrowthRow = {
  day: string;
  dayLabel: string;
  total: number;
};
