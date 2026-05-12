-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_verifications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "verificationType" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "confidence" REAL,
    "creditsUsed" INTEGER NOT NULL DEFAULT 1,
    "rawResponse" TEXT,
    "batchId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_verifications" ("batchId", "clientId", "confidence", "contactId", "createdAt", "id", "provider", "rawResponse", "status", "verificationType") SELECT "batchId", "clientId", "confidence", "contactId", "createdAt", "id", "provider", "rawResponse", "status", "verificationType" FROM "verifications";
DROP TABLE "verifications";
ALTER TABLE "new_verifications" RENAME TO "verifications";
CREATE INDEX "verifications_clientId_idx" ON "verifications"("clientId");
CREATE INDEX "verifications_contactId_idx" ON "verifications"("contactId");
CREATE INDEX "verifications_batchId_idx" ON "verifications"("batchId");
CREATE INDEX "verifications_verificationType_status_idx" ON "verifications"("verificationType", "status");
CREATE INDEX "verifications_contactId_createdAt_idx" ON "verifications"("contactId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
