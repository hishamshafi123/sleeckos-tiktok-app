-- AlterTable
ALTER TABLE "ManagedAccount" ADD COLUMN "sweepNotFoundStreak" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ManagedAccount" ADD COLUMN "lastSweepError" TEXT;

-- AlterTable
ALTER TABLE "ManagedAccount" ADD COLUMN "lastSweepOkAt" TIMESTAMP(3);
