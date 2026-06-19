-- AlterTable
ALTER TABLE "ClipFolder" ADD COLUMN     "campaignId" TEXT;

-- AddForeignKey
ALTER TABLE "ClipFolder" ADD CONSTRAINT "ClipFolder_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
