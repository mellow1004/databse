-- AlterTable
ALTER TABLE "companies" ADD COLUMN "mergedIntoId" TEXT;

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN "mergedIntoId" TEXT;

-- CreateIndex
CREATE INDEX "companies_mergedIntoId_idx" ON "companies"("mergedIntoId");

-- CreateIndex
CREATE INDEX "contacts_mergedIntoId_idx" ON "contacts"("mergedIntoId");
