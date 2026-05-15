export type BiasSubgroupRow = {
  key: string;
  label: string;
  contacts: number;
  gate2Count: number;
  gate2Rate: number;
  deltaPp: number;
  inTolerance: boolean;
  barFill: string;
};

export type BiasCategorySection = {
  id: "country" | "headcount" | "gender";
  title: string;
  description: string;
  footnote?: string;
  rows: BiasSubgroupRow[];
  flaggedCount: number;
  empty: boolean;
};

export type BiasMonitoringReport = {
  overallRate: number;
  overallGate2Count: number;
  totalActive: number;
  totalSkippedSmallSample: number;
  tolerancePp: number;
  country: BiasCategorySection;
  headcount: BiasCategorySection;
  gender: BiasCategorySection;
};
