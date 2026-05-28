-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "lawfulBasis" TEXT,
ADD COLUMN     "liaCompletedAt" TIMESTAMP(3),
ADD COLUMN     "liaStatus" TEXT,
ADD COLUMN     "market" TEXT,
ADD COLUMN     "processingPurpose" TEXT,
ADD COLUMN     "retentionReviewDueAt" TIMESTAMP(3),
ADD COLUMN     "retentionStatus" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN     "sensitivityTier" TEXT;

-- AlterTable
ALTER TABLE "quarantine_log" ADD COLUMN     "approvalPath" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "approvalRequestedAt" TIMESTAMP(3),
ADD COLUMN     "approvalRequestedBy" TEXT,
ADD COLUMN     "escalatedAt" TIMESTAMP(3),
ADD COLUMN     "previousGate" TEXT,
ADD COLUMN     "proposedRestoredGate" TEXT;

-- AlterTable
ALTER TABLE "suppressions" ADD COLUMN     "affectedClientCount" INTEGER,
ADD COLUMN     "regulatoryReviewAt" TIMESTAMP(3),
ADD COLUMN     "regulatoryReviewBy" TEXT,
ADD COLUMN     "regulatoryReviewCompleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "regulatoryReviewNotes" TEXT,
ADD COLUMN     "releaseApprovalReason" TEXT,
ADD COLUMN     "releaseApprovalRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "releaseApprovedAt" TIMESTAMP(3),
ADD COLUMN     "releaseApprovedBy" TEXT,
ADD COLUMN     "releaseRequestedAt" TIMESTAMP(3),
ADD COLUMN     "releaseRequestedBy" TEXT;

-- CreateTable
CREATE TABLE "dsar_cases" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "caseNumber" TEXT NOT NULL,
    "caseType" TEXT NOT NULL,
    "subjectEmail" TEXT,
    "subjectPhone" TEXT,
    "subjectLinkedinUrl" TEXT,
    "subjectName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closureReason" TEXT,
    "ownerId" TEXT NOT NULL,
    "tombstoneCreated" BOOLEAN NOT NULL DEFAULT false,
    "tombstoneCreatedAt" TIMESTAMP(3),
    "aiTrainingDatasetNotified" BOOLEAN NOT NULL DEFAULT false,
    "aiTrainingDatasetAt" TIMESTAMP(3),
    "aiSdrPlatformNotified" BOOLEAN NOT NULL DEFAULT false,
    "aiSdrPlatformAt" TIMESTAMP(3),
    "subProcessorsNotified" BOOLEAN NOT NULL DEFAULT false,
    "subProcessorsAt" TIMESTAMP(3),
    "propagationCompletedAt" TIMESTAMP(3),
    "matchedContactIds" TEXT,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dsar_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dsar_actions" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dsar_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulk_action_approvals" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "actionType" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordsAffected" INTEGER NOT NULL,
    "requestPayload" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalReason" TEXT,
    "rejectedBy" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "executedAt" TIMESTAMP(3),
    "executionDetail" TEXT,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "bulk_action_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dsar_cases_caseNumber_key" ON "dsar_cases"("caseNumber");

-- CreateIndex
CREATE INDEX "dsar_cases_clientId_idx" ON "dsar_cases"("clientId");

-- CreateIndex
CREATE INDEX "dsar_cases_status_idx" ON "dsar_cases"("status");

-- CreateIndex
CREATE INDEX "dsar_cases_deadlineAt_idx" ON "dsar_cases"("deadlineAt");

-- CreateIndex
CREATE INDEX "dsar_cases_caseType_idx" ON "dsar_cases"("caseType");

-- CreateIndex
CREATE INDEX "dsar_cases_ownerId_idx" ON "dsar_cases"("ownerId");

-- CreateIndex
CREATE INDEX "dsar_actions_caseId_idx" ON "dsar_actions"("caseId");

-- CreateIndex
CREATE INDEX "dsar_actions_actionType_idx" ON "dsar_actions"("actionType");

-- CreateIndex
CREATE INDEX "dsar_actions_createdAt_idx" ON "dsar_actions"("createdAt");

-- CreateIndex
CREATE INDEX "bulk_action_approvals_status_idx" ON "bulk_action_approvals"("status");

-- CreateIndex
CREATE INDEX "bulk_action_approvals_clientId_idx" ON "bulk_action_approvals"("clientId");

-- CreateIndex
CREATE INDEX "bulk_action_approvals_requestedBy_idx" ON "bulk_action_approvals"("requestedBy");

-- CreateIndex
CREATE INDEX "bulk_action_approvals_actionType_idx" ON "bulk_action_approvals"("actionType");

-- CreateIndex
CREATE INDEX "contacts_retentionStatus_idx" ON "contacts"("retentionStatus");

-- CreateIndex
CREATE INDEX "contacts_retentionReviewDueAt_idx" ON "contacts"("retentionReviewDueAt");
