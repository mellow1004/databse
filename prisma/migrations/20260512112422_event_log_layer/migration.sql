-- CreateTable
CREATE TABLE "enrichment_log" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "contactId" TEXT,
    "companyId" TEXT,
    "batchId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "fieldsFilled" TEXT NOT NULL,
    "confidence" REAL,
    "rawResponse" TEXT,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "creditsUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "verificationType" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "confidence" REAL,
    "rawResponse" TEXT,
    "batchId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "gate_status_history" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "fromGate" TEXT,
    "toGate" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "derivedFieldVersion" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "merge_history" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "mergeType" TEXT NOT NULL,
    "survivorId" TEXT NOT NULL,
    "mergedFromId" TEXT NOT NULL,
    "fieldsResolved" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "batchId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "quarantine_log" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "contactId" TEXT,
    "companyId" TEXT,
    "reasonCode" TEXT NOT NULL,
    "reasonDetail" TEXT,
    "actor" TEXT NOT NULL,
    "reviewState" TEXT NOT NULL DEFAULT 'pending',
    "releasedAt" DATETIME,
    "releasedBy" TEXT,
    "releaseReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "refresh_log" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "cycleNumber" INTEGER NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "status" TEXT NOT NULL,
    "recordsReVerified" INTEGER NOT NULL DEFAULT 0,
    "recordsDowngraded" INTEGER NOT NULL DEFAULT 0,
    "recordsAnonymised" INTEGER NOT NULL DEFAULT 0,
    "recordsGapFilled" INTEGER NOT NULL DEFAULT 0,
    "providerAccuracy" TEXT,
    "costEstimate" REAL,
    "notes" TEXT
);

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
CREATE INDEX "refresh_log_clientId_idx" ON "refresh_log"("clientId");

-- CreateIndex
CREATE INDEX "refresh_log_cycleNumber_idx" ON "refresh_log"("cycleNumber");

-- CreateIndex
CREATE INDEX "refresh_log_status_idx" ON "refresh_log"("status");
