export type DataDictionaryField = {
  name: string;
  type: string;
  requiredByGate: string;
  defaultValue: string;
  sourceRule: string;
  sensitivityTier: "Personal" | "Business contact" | "Public";
  notes: string;
};

export type DataDictionaryModel = {
  model: string;
  fields: DataDictionaryField[];
};

export const DATA_DICTIONARY: DataDictionaryModel[] = [
  {
    model: "Contact",
    fields: [
      { name: "email", type: "String?", requiredByGate: "Gate 2 deliverability", defaultValue: "null", sourceRule: "Intake + verification", sensitivityTier: "Personal", notes: "Primary personal identifier." },
      { name: "phone", type: "String?", requiredByGate: "Gate 2 deliverability", defaultValue: "null", sourceRule: "Intake + verification", sensitivityTier: "Personal", notes: "PII identifier and verification target." },
      { name: "title", type: "String?", requiredByGate: "Gate 1/2 structural completeness", defaultValue: "null", sourceRule: "Intake + enrichment", sensitivityTier: "Business contact", notes: "Role claim used in readiness scoring." },
      { name: "seniority", type: "String?", requiredByGate: "Gate targeting quality", defaultValue: "null", sourceRule: "Intake + enrichment", sensitivityTier: "Business contact", notes: "Seniority taxonomy." },
      { name: "gateStatus", type: "String", requiredByGate: "Core gate state", defaultValue: "gate_0", sourceRule: "Gates service", sensitivityTier: "Public", notes: "Promotion/demotion state machine." },
      { name: "lifecycleStage", type: "String", requiredByGate: "Refresh-tier routing", defaultValue: "active", sourceRule: "Lifecycle + refresh cycle", sensitivityTier: "Public", notes: "active/dormant/frozen/anonymised/legal_hold." },
      { name: "lastVerifiedAt", type: "DateTime?", requiredByGate: "Freshness criterion", defaultValue: "null", sourceRule: "Verification service", sensitivityTier: "Public", notes: "Used for 90-day freshness windows." },
      { name: "lastEnrichedAt", type: "DateTime?", requiredByGate: "Refresh cadence", defaultValue: "null", sourceRule: "Enrichment service", sensitivityTier: "Public", notes: "Used for dormant 180-day enrichment." },
    ],
  },
  {
    model: "Person",
    fields: [
      { name: "fullName", type: "String", requiredByGate: "Structural completeness", defaultValue: "required", sourceRule: "Intake parser", sensitivityTier: "Personal", notes: "Canonical display name." },
      { name: "primaryEmail", type: "String?", requiredByGate: "Identity matching", defaultValue: "null", sourceRule: "Identity resolver", sensitivityTier: "Personal", notes: "Persistent person-level email." },
      { name: "primaryPhone", type: "String?", requiredByGate: "Identity matching", defaultValue: "null", sourceRule: "Identity resolver", sensitivityTier: "Personal", notes: "Persistent person-level phone." },
      { name: "linkedinUrl", type: "String?", requiredByGate: "Dedup confidence", defaultValue: "null", sourceRule: "Intake + normalization", sensitivityTier: "Personal", notes: "Canonical identity anchor." },
    ],
  },
  {
    model: "Company",
    fields: [
      { name: "legalName", type: "String", requiredByGate: "Context quality", defaultValue: "required", sourceRule: "Intake + merge", sensitivityTier: "Business contact", notes: "Canonical company name." },
      { name: "rootDomain", type: "String", requiredByGate: "Suppression/domain checks", defaultValue: "required", sourceRule: "Normalization", sensitivityTier: "Business contact", notes: "Primary domain key." },
      { name: "country", type: "String?", requiredByGate: "Provider routing", defaultValue: "null", sourceRule: "Intake + enrichment", sensitivityTier: "Business contact", notes: "ISO country used by market logic." },
      { name: "industry", type: "String?", requiredByGate: "Targeting quality", defaultValue: "null", sourceRule: "Enrichment", sensitivityTier: "Business contact", notes: "Firmographic trait." },
    ],
  },
  {
    model: "RefreshLog",
    fields: [
      { name: "status", type: "String", requiredByGate: "Operations control", defaultValue: "in_progress", sourceRule: "Refresh orchestrator", sensitivityTier: "Public", notes: "Run lifecycle status." },
      { name: "recordsReVerified", type: "Int", requiredByGate: "Run accountability", defaultValue: "0", sourceRule: "Refresh orchestrator", sensitivityTier: "Public", notes: "Processed scope count." },
      { name: "costEstimate", type: "Float?", requiredByGate: "Budget governance", defaultValue: "null", sourceRule: "Refresh orchestrator", sensitivityTier: "Public", notes: "Estimated EUR per run." },
      { name: "notes", type: "String?", requiredByGate: "Progress telemetry", defaultValue: "null", sourceRule: "Refresh orchestrator", sensitivityTier: "Public", notes: "Progress checkpoints/errors JSON." },
    ],
  },
  {
    model: "BatchSnapshot",
    fields: [
      { name: "batchId", type: "String", requiredByGate: "Rollback lookup", defaultValue: "required", sourceRule: "Snapshot service", sensitivityTier: "Public", notes: "Groups restorable writes." },
      { name: "batchType", type: "String", requiredByGate: "Rollback policy", defaultValue: "required", sourceRule: "Snapshot service", sensitivityTier: "Public", notes: "enrichment/refresh_cycle/import_promotion/merge/bulk_suppression." },
      { name: "recordType", type: "String", requiredByGate: "Rollback apply", defaultValue: "required", sourceRule: "Snapshot service", sensitivityTier: "Public", notes: "contact or company." },
      { name: "preWriteState", type: "String", requiredByGate: "Rollback restore", defaultValue: "required", sourceRule: "Snapshot service", sensitivityTier: "Public", notes: "JSON of fields changed before write." },
      { name: "expiresAt", type: "DateTime", requiredByGate: "Retention window", defaultValue: "createdAt + 30d", sourceRule: "Snapshot service", sensitivityTier: "Public", notes: "Snapshot expiry boundary." },
    ],
  },
  {
    model: "AuditLog",
    fields: [
      { name: "action", type: "String", requiredByGate: "Governance trace", defaultValue: "required", sourceRule: "All services", sensitivityTier: "Public", notes: "Action verb for immutable audit events." },
      { name: "resourceType", type: "String", requiredByGate: "Entity traceability", defaultValue: "required", sourceRule: "All services", sensitivityTier: "Public", notes: "Entity class being changed." },
      { name: "resourceId", type: "String?", requiredByGate: "Entity traceability", defaultValue: "null", sourceRule: "All services", sensitivityTier: "Public", notes: "Entity identifier when available." },
      { name: "afterState", type: "String?", requiredByGate: "Forensics", defaultValue: "null", sourceRule: "All services", sensitivityTier: "Public", notes: "JSON payload of post-action state." },
    ],
  },
];
