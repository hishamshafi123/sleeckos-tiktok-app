-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CampaignStatus" ADD VALUE 'ACTIVE';
ALTER TYPE "CampaignStatus" ADD VALUE 'PAUSED';
ALTER TYPE "CampaignStatus" ADD VALUE 'DONE';

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "accountsCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "avgViewsPerVideo" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "infoContent" TEXT,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "targetViews" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'other',
ADD COLUMN     "videosPerAccountPerDay" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CampaignResource" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignResource_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CampaignResource" ADD CONSTRAINT "CampaignResource_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
