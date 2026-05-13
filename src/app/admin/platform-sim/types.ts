export type ActiveCampaignRow = {
  id: string;
  fullName: string;
  email: string | null;
  companyName: string;
  gateStatus: string;
  lastVerifiedAt: string | null;
};

export type RecentSimulatorEvent = {
  id: string;
  action: string;
  createdAt: string;
  afterState: string | null;
  resourceId: string | null;
  resourceLabel: string;
};

export type TargetingContactRow = {
  contactId: string;
  fullName: string;
  email: string | null;
  title: string | null;
  companyName: string;
  country: string | null;
  gateStatus: string;
  lastVerifiedAt: string | null;
  campaignActive: boolean;
};
