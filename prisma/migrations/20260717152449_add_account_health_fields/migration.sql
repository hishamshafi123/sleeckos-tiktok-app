-- AlterTable
ALTER TABLE "ManagedAccount" ADD COLUMN     "connectionState" TEXT NOT NULL DEFAULT 'healthy',
ADD COLUMN     "lastCheckedAt" TIMESTAMP(3),
ADD COLUMN     "lastError" TEXT;
