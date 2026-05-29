-- AlterTable
ALTER TABLE "dsar_cases" ADD COLUMN     "otto2At" TIMESTAMP(3),
ADD COLUMN     "otto2Notified" BOOLEAN NOT NULL DEFAULT false;
