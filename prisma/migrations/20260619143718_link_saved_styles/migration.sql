-- AlterTable
ALTER TABLE "AccountGenreConfig" ADD COLUMN     "savedStyleId" TEXT;

-- AlterTable
ALTER TABLE "GenreBatchItem" ADD COLUMN     "parameterTweaks" TEXT,
ADD COLUMN     "savedStyleId" TEXT;

-- AlterTable
ALTER TABLE "TrackLyricalTemplate" ADD COLUMN     "savedStyleId" TEXT;

-- AddForeignKey
ALTER TABLE "TrackLyricalTemplate" ADD CONSTRAINT "TrackLyricalTemplate_savedStyleId_fkey" FOREIGN KEY ("savedStyleId") REFERENCES "SavedStyle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountGenreConfig" ADD CONSTRAINT "AccountGenreConfig_savedStyleId_fkey" FOREIGN KEY ("savedStyleId") REFERENCES "SavedStyle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenreBatchItem" ADD CONSTRAINT "GenreBatchItem_savedStyleId_fkey" FOREIGN KEY ("savedStyleId") REFERENCES "SavedStyle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
