-- AlterTable
ALTER TABLE "ClipMixerItem" ADD COLUMN     "lyricalTemplateId" TEXT;

-- AddForeignKey
ALTER TABLE "ClipMixerItem" ADD CONSTRAINT "ClipMixerItem_lyricalTemplateId_fkey" FOREIGN KEY ("lyricalTemplateId") REFERENCES "TrackLyricalTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
