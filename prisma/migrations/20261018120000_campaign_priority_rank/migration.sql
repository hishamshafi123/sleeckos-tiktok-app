-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN "priorityRank" INTEGER;

-- CreateIndex
CREATE INDEX "PostJob_campaignId_state_idx" ON "PostJob"("campaignId", "state");
