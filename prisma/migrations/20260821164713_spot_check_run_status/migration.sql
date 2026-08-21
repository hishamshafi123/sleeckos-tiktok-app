-- AlterTable
ALTER TABLE "CampaignSpotCheck" ADD COLUMN     "error" TEXT,
ADD COLUMN     "finishedAt" TIMESTAMP(3),
ADD COLUMN     "processedTargets" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'running',
ADD COLUMN     "totalTargets" INTEGER NOT NULL DEFAULT 0;
