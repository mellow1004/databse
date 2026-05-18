-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "persons" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "linkedinUrl" TEXT,
    "primaryEmail" TEXT,
    "primaryPhone" TEXT,
    "fullName" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "inferredGender" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "rootDomain" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "parentCompanyId" TEXT,
    "industry" TEXT,
    "country" TEXT,
    "headcountBand" TEXT,
    "mergedIntoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domain_aliases" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "aliasDomain" TEXT NOT NULL,
    "aliasType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "domain_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "title" TEXT,
    "seniority" TEXT,
    "gateStatus" TEXT NOT NULL DEFAULT 'gate_0',
    "campaignActive" BOOLEAN NOT NULL DEFAULT false,
    "quarantineReason" TEXT,
    "lifecycleStage" TEXT NOT NULL DEFAULT 'active',
    "mergedIntoId" TEXT,
    "freshnessLabel" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastEnrichedAt" TIMESTAMP(3),
    "derivedFieldVersion" TEXT,
    "writeSource" TEXT,
    "writePriority" INTEGER,
    "manualOverrideUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_company_relationships" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "roleType" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_company_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrichment_log" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "contactId" TEXT,
    "companyId" TEXT,
    "batchId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "fieldsFilled" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "rawResponse" TEXT,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "creditsUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrichment_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "verificationType" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "creditsUsed" INTEGER NOT NULL DEFAULT 1,
    "rawResponse" TEXT,
    "batchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gate_status_history" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "fromGate" TEXT,
    "toGate" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "derivedFieldVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gate_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merge_history" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "mergeType" TEXT NOT NULL,
    "survivorId" TEXT NOT NULL,
    "mergedFromId" TEXT NOT NULL,
    "fieldsResolved" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "batchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merge_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quarantine_log" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "contactId" TEXT,
    "companyId" TEXT,
    "reasonCode" TEXT NOT NULL,
    "reasonDetail" TEXT,
    "actor" TEXT NOT NULL,
    "reviewState" TEXT NOT NULL DEFAULT 'pending',
    "releasedAt" TIMESTAMP(3),
    "releasedBy" TEXT,
    "releaseReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quarantine_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accuracy_samples" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "cycleNumber" INTEGER NOT NULL,
    "contactId" TEXT NOT NULL,
    "enrichmentLogId" TEXT,
    "fieldChecked" TEXT NOT NULL,
    "expectedValue" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "reviewerId" TEXT,
    "isCorrect" BOOLEAN,
    "actualValue" TEXT,
    "notes" TEXT,
    "sampledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accuracy_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_log" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "cycleNumber" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "recordsReVerified" INTEGER NOT NULL DEFAULT 0,
    "recordsDowngraded" INTEGER NOT NULL DEFAULT 0,
    "recordsAnonymised" INTEGER NOT NULL DEFAULT 0,
    "recordsGapFilled" INTEGER NOT NULL DEFAULT 0,
    "providerAccuracy" TEXT,
    "costEstimate" DOUBLE PRECISION,
    "notes" TEXT,

    CONSTRAINT "refresh_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppressions" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "clientId" TEXT,
    "contactId" TEXT,
    "email" TEXT,
    "domain" TEXT,
    "reasonCode" TEXT NOT NULL,
    "reasonDetail" TEXT,
    "owner" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "isOptOut" BOOLEAN NOT NULL DEFAULT false,
    "coolingPeriodIndefinite" BOOLEAN NOT NULL DEFAULT true,
    "reviewRequiredBefore" TIMESTAMP(3),
    "releaseStatus" TEXT NOT NULL DEFAULT 'active',
    "releasedAt" TIMESTAMP(3),
    "releasedBy" TEXT,
    "releaseReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tombstones" (
    "id" TEXT NOT NULL,
    "hashType" TEXT NOT NULL,
    "hashValue" TEXT NOT NULL,
    "originalClientId" TEXT,
    "deletionReason" TEXT NOT NULL,
    "deletionActor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tombstones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "clientId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "aiLiteracyTrainingCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'own_client',
    "conditions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "actorUserId" TEXT,
    "actorRole" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "batchId" TEXT,
    "recordsAffected" INTEGER NOT NULL DEFAULT 1,
    "approvalGranted" BOOLEAN,
    "approverUserId" TEXT,
    "beforeState" TEXT,
    "afterState" TEXT,
    "sensitivityTier" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_contracts" (
    "id" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "providerType" TEXT NOT NULL,
    "contractVersion" TEXT NOT NULL,
    "dataProcessingAgreementSigned" BOOLEAN NOT NULL DEFAULT false,
    "sccsInPlace" BOOLEAN NOT NULL DEFAULT false,
    "transferMechanism" TEXT,
    "transferImpactAssessmentRef" TEXT,
    "subProcessorRegisterUpdated" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "rateLimitConfig" TEXT,
    "dailyCreditBudget" INTEGER,
    "primaryMarkets" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "sourceDetail" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "rowsTotal" INTEGER NOT NULL DEFAULT 0,
    "rowsAccepted" INTEGER NOT NULL DEFAULT 0,
    "rowsRejected" INTEGER NOT NULL DEFAULT 0,
    "rowsPromoted" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staging_records" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rawValues" TEXT NOT NULL,
    "candidateEmail" TEXT,
    "candidateLinkedinUrl" TEXT,
    "candidatePhone" TEXT,
    "candidateFullName" TEXT,
    "candidateCompanyName" TEXT,
    "candidateDomain" TEXT,
    "candidateTitle" TEXT,
    "candidateCountry" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "rejectionReason" TEXT,
    "rejectionDetail" TEXT,
    "promotedContactId" TEXT,
    "promotedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staging_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "persons_clientId_idx" ON "persons"("clientId");

-- CreateIndex
CREATE INDEX "persons_primaryEmail_idx" ON "persons"("primaryEmail");

-- CreateIndex
CREATE UNIQUE INDEX "persons_clientId_linkedinUrl_key" ON "persons"("clientId", "linkedinUrl");

-- CreateIndex
CREATE INDEX "companies_clientId_idx" ON "companies"("clientId");

-- CreateIndex
CREATE INDEX "companies_mergedIntoId_idx" ON "companies"("mergedIntoId");

-- CreateIndex
CREATE UNIQUE INDEX "companies_clientId_rootDomain_key" ON "companies"("clientId", "rootDomain");

-- CreateIndex
CREATE INDEX "domain_aliases_companyId_idx" ON "domain_aliases"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "domain_aliases_clientId_aliasDomain_key" ON "domain_aliases"("clientId", "aliasDomain");

-- CreateIndex
CREATE INDEX "contacts_clientId_idx" ON "contacts"("clientId");

-- CreateIndex
CREATE INDEX "contacts_personId_idx" ON "contacts"("personId");

-- CreateIndex
CREATE INDEX "contacts_companyId_idx" ON "contacts"("companyId");

-- CreateIndex
CREATE INDEX "contacts_gateStatus_idx" ON "contacts"("gateStatus");

-- CreateIndex
CREATE INDEX "contacts_campaignActive_idx" ON "contacts"("campaignActive");

-- CreateIndex
CREATE INDEX "contacts_mergedIntoId_idx" ON "contacts"("mergedIntoId");

-- CreateIndex
CREATE INDEX "contact_company_relationships_contactId_idx" ON "contact_company_relationships"("contactId");

-- CreateIndex
CREATE INDEX "contact_company_relationships_companyId_idx" ON "contact_company_relationships"("companyId");

-- CreateIndex
CREATE INDEX "contact_company_relationships_clientId_roleType_idx" ON "contact_company_relationships"("clientId", "roleType");

-- CreateIndex
CREATE INDEX "enrichment_log_clientId_idx" ON "enrichment_log"("clientId");

-- CreateIndex
CREATE INDEX "enrichment_log_batchId_idx" ON "enrichment_log"("batchId");

-- CreateIndex
CREATE INDEX "enrichment_log_contactId_idx" ON "enrichment_log"("contactId");

-- CreateIndex
CREATE INDEX "enrichment_log_companyId_idx" ON "enrichment_log"("companyId");

-- CreateIndex
CREATE INDEX "enrichment_log_provider_createdAt_idx" ON "enrichment_log"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "verifications_clientId_idx" ON "verifications"("clientId");

-- CreateIndex
CREATE INDEX "verifications_contactId_idx" ON "verifications"("contactId");

-- CreateIndex
CREATE INDEX "verifications_batchId_idx" ON "verifications"("batchId");

-- CreateIndex
CREATE INDEX "verifications_verificationType_status_idx" ON "verifications"("verificationType", "status");

-- CreateIndex
CREATE INDEX "verifications_contactId_createdAt_idx" ON "verifications"("contactId", "createdAt");

-- CreateIndex
CREATE INDEX "gate_status_history_clientId_idx" ON "gate_status_history"("clientId");

-- CreateIndex
CREATE INDEX "gate_status_history_contactId_idx" ON "gate_status_history"("contactId");

-- CreateIndex
CREATE INDEX "gate_status_history_toGate_createdAt_idx" ON "gate_status_history"("toGate", "createdAt");

-- CreateIndex
CREATE INDEX "merge_history_clientId_idx" ON "merge_history"("clientId");

-- CreateIndex
CREATE INDEX "merge_history_survivorId_idx" ON "merge_history"("survivorId");

-- CreateIndex
CREATE INDEX "merge_history_mergedFromId_idx" ON "merge_history"("mergedFromId");

-- CreateIndex
CREATE INDEX "merge_history_batchId_idx" ON "merge_history"("batchId");

-- CreateIndex
CREATE INDEX "quarantine_log_clientId_idx" ON "quarantine_log"("clientId");

-- CreateIndex
CREATE INDEX "quarantine_log_contactId_idx" ON "quarantine_log"("contactId");

-- CreateIndex
CREATE INDEX "quarantine_log_companyId_idx" ON "quarantine_log"("companyId");

-- CreateIndex
CREATE INDEX "quarantine_log_reviewState_idx" ON "quarantine_log"("reviewState");

-- CreateIndex
CREATE INDEX "quarantine_log_reasonCode_idx" ON "quarantine_log"("reasonCode");

-- CreateIndex
CREATE INDEX "accuracy_samples_provider_cycleNumber_idx" ON "accuracy_samples"("provider", "cycleNumber");

-- CreateIndex
CREATE INDEX "accuracy_samples_reviewedAt_idx" ON "accuracy_samples"("reviewedAt");

-- CreateIndex
CREATE INDEX "accuracy_samples_clientId_idx" ON "accuracy_samples"("clientId");

-- CreateIndex
CREATE INDEX "refresh_log_clientId_idx" ON "refresh_log"("clientId");

-- CreateIndex
CREATE INDEX "refresh_log_cycleNumber_idx" ON "refresh_log"("cycleNumber");

-- CreateIndex
CREATE INDEX "refresh_log_status_idx" ON "refresh_log"("status");

-- CreateIndex
CREATE INDEX "suppressions_scope_idx" ON "suppressions"("scope");

-- CreateIndex
CREATE INDEX "suppressions_clientId_idx" ON "suppressions"("clientId");

-- CreateIndex
CREATE INDEX "suppressions_email_idx" ON "suppressions"("email");

-- CreateIndex
CREATE INDEX "suppressions_domain_idx" ON "suppressions"("domain");

-- CreateIndex
CREATE INDEX "suppressions_contactId_idx" ON "suppressions"("contactId");

-- CreateIndex
CREATE INDEX "suppressions_releaseStatus_idx" ON "suppressions"("releaseStatus");

-- CreateIndex
CREATE INDEX "tombstones_hashType_idx" ON "tombstones"("hashType");

-- CreateIndex
CREATE UNIQUE INDEX "tombstones_hashType_hashValue_key" ON "tombstones"("hashType", "hashValue");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_clientId_idx" ON "users"("clientId");

-- CreateIndex
CREATE INDEX "role_permissions_role_idx" ON "role_permissions"("role");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_role_resource_action_scope_key" ON "role_permissions"("role", "resource", "action", "scope");

-- CreateIndex
CREATE INDEX "audit_log_clientId_idx" ON "audit_log"("clientId");

-- CreateIndex
CREATE INDEX "audit_log_actorUserId_idx" ON "audit_log"("actorUserId");

-- CreateIndex
CREATE INDEX "audit_log_resourceType_resourceId_idx" ON "audit_log"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "audit_log_batchId_idx" ON "audit_log"("batchId");

-- CreateIndex
CREATE INDEX "audit_log_action_createdAt_idx" ON "audit_log"("action", "createdAt");

-- CreateIndex
CREATE INDEX "audit_log_sensitivityTier_idx" ON "audit_log"("sensitivityTier");

-- CreateIndex
CREATE INDEX "integration_contracts_providerName_idx" ON "integration_contracts"("providerName");

-- CreateIndex
CREATE INDEX "integration_contracts_status_idx" ON "integration_contracts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "integration_contracts_providerName_contractVersion_key" ON "integration_contracts"("providerName", "contractVersion");

-- CreateIndex
CREATE INDEX "import_batches_clientId_idx" ON "import_batches"("clientId");

-- CreateIndex
CREATE INDEX "import_batches_status_idx" ON "import_batches"("status");

-- CreateIndex
CREATE INDEX "import_batches_uploadedBy_idx" ON "import_batches"("uploadedBy");

-- CreateIndex
CREATE INDEX "staging_records_clientId_idx" ON "staging_records"("clientId");

-- CreateIndex
CREATE INDEX "staging_records_batchId_idx" ON "staging_records"("batchId");

-- CreateIndex
CREATE INDEX "staging_records_status_idx" ON "staging_records"("status");

-- CreateIndex
CREATE INDEX "staging_records_batchId_rowNumber_idx" ON "staging_records"("batchId", "rowNumber");

-- AddForeignKey
ALTER TABLE "persons" ADD CONSTRAINT "persons_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_parentCompanyId_fkey" FOREIGN KEY ("parentCompanyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "domain_aliases" ADD CONSTRAINT "domain_aliases_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "domain_aliases" ADD CONSTRAINT "domain_aliases_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_company_relationships" ADD CONSTRAINT "contact_company_relationships_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_company_relationships" ADD CONSTRAINT "contact_company_relationships_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_company_relationships" ADD CONSTRAINT "contact_company_relationships_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
