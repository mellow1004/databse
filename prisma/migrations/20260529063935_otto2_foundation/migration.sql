-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "totalCallAttempts" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "otto2_calls" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "sdrUserId" TEXT,
    "outcome" TEXT NOT NULL,
    "durationSec" INTEGER,
    "notes" TEXT,
    "calledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otto2_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otto2_callback_queue" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdFromCallId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otto2_callback_queue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "otto2_calls_contactId_calledAt_idx" ON "otto2_calls"("contactId", "calledAt");

-- CreateIndex
CREATE INDEX "otto2_calls_clientId_idx" ON "otto2_calls"("clientId");

-- CreateIndex
CREATE INDEX "otto2_calls_outcome_idx" ON "otto2_calls"("outcome");

-- CreateIndex
CREATE INDEX "otto2_callback_queue_scheduledFor_idx" ON "otto2_callback_queue"("scheduledFor");

-- CreateIndex
CREATE INDEX "otto2_callback_queue_contactId_idx" ON "otto2_callback_queue"("contactId");

-- CreateIndex
CREATE INDEX "otto2_callback_queue_status_idx" ON "otto2_callback_queue"("status");

-- CreateIndex
CREATE INDEX "contacts_phoneVerified_idx" ON "contacts"("phoneVerified");
