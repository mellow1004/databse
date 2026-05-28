-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "hardBounceCount30d" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastCampaignAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "batch_snapshots" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "batchType" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "preWriteState" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batch_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_budgets" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "clientId" TEXT,
    "periodType" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "budgetEur" DOUBLE PRECISION NOT NULL,
    "spentEur" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "creditsUsed" INTEGER NOT NULL DEFAULT 0,
    "alertThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
    "alertedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppression_import_batches" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "listType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "rowsTotal" INTEGER NOT NULL DEFAULT 0,
    "rowsImported" INTEGER NOT NULL DEFAULT 0,
    "rowsRejected" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "suppression_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bounce_events" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "bounceType" TEXT NOT NULL,
    "reason" TEXT,
    "source" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "escalatedToSuppression" BOOLEAN NOT NULL DEFAULT false,
    "escalatedSuppressionId" TEXT,

    CONSTRAINT "bounce_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "batch_snapshots_batchId_idx" ON "batch_snapshots"("batchId");

-- CreateIndex
CREATE INDEX "batch_snapshots_recordId_idx" ON "batch_snapshots"("recordId");

-- CreateIndex
CREATE INDEX "batch_snapshots_expiresAt_idx" ON "batch_snapshots"("expiresAt");

-- CreateIndex
CREATE INDEX "provider_budgets_periodStart_periodEnd_idx" ON "provider_budgets"("periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "provider_budgets_provider_clientId_periodType_periodStart_key" ON "provider_budgets"("provider", "clientId", "periodType", "periodStart");

-- CreateIndex
CREATE INDEX "suppression_import_batches_clientId_idx" ON "suppression_import_batches"("clientId");

-- CreateIndex
CREATE INDEX "suppression_import_batches_status_idx" ON "suppression_import_batches"("status");

-- CreateIndex
CREATE INDEX "bounce_events_contactId_occurredAt_idx" ON "bounce_events"("contactId", "occurredAt");

-- CreateIndex
CREATE INDEX "bounce_events_bounceType_occurredAt_idx" ON "bounce_events"("bounceType", "occurredAt");
