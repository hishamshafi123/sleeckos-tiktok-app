-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "failedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "postedCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PostJob" ADD COLUMN     "campaignId" TEXT;
