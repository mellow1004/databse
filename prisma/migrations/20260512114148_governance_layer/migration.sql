-- CreateTable
CREATE TABLE "suppressions" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "reviewRequiredBefore" DATETIME,
    "releaseStatus" TEXT NOT NULL DEFAULT 'active',
    "releasedAt" DATETIME,
    "releasedBy" TEXT,
    "releaseReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "tombstones" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hashType" TEXT NOT NULL,
    "hashValue" TEXT NOT NULL,
    "originalClientId" TEXT,
    "deletionReason" TEXT NOT NULL,
    "deletionActor" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "clientId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "aiLiteracyTrainingCompletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "role" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'own_client',
    "conditions" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "integration_contracts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerName" TEXT NOT NULL,
    "providerType" TEXT NOT NULL,
    "contractVersion" TEXT NOT NULL,
    "dataProcessingAgreementSigned" BOOLEAN NOT NULL DEFAULT false,
    "sccsInPlace" BOOLEAN NOT NULL DEFAULT false,
    "transferMechanism" TEXT,
    "transferImpactAssessmentRef" TEXT,
    "subProcessorRegisterUpdated" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'active',
    "rateLimitConfig" TEXT,
    "dailyCreditBudget" INTEGER,
    "primaryMarkets" TEXT,
    "effectiveFrom" DATETIME NOT NULL,
    "effectiveUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

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
