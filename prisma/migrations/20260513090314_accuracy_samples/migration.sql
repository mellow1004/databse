-- CreateTable
CREATE TABLE "accuracy_samples" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "cycleNumber" INTEGER NOT NULL,
    "contactId" TEXT NOT NULL,
    "enrichmentLogId" TEXT,
    "fieldChecked" TEXT NOT NULL,
    "expectedValue" TEXT NOT NULL,
    "reviewedAt" DATETIME,
    "reviewerId" TEXT,
    "isCorrect" BOOLEAN,
    "actualValue" TEXT,
    "notes" TEXT,
    "sampledAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "accuracy_samples_provider_cycleNumber_idx" ON "accuracy_samples"("provider", "cycleNumber");

-- CreateIndex
CREATE INDEX "accuracy_samples_reviewedAt_idx" ON "accuracy_samples"("reviewedAt");

-- CreateIndex
CREATE INDEX "accuracy_samples_clientId_idx" ON "accuracy_samples"("clientId");
