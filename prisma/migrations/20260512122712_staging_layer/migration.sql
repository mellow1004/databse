-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME
);

-- CreateTable
CREATE TABLE "staging_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "promotedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
