-- DropIndex
DROP INDEX "ClipFolder_sectionId_name_key";

-- AlterTable
ALTER TABLE "ClipFolder" ADD COLUMN     "parentId" TEXT;

-- AlterTable
ALTER TABLE "ClipMixerItem" ADD COLUMN     "folderId" TEXT;

-- AlterTable
ALTER TABLE "TrackLyricalTemplate" ADD COLUMN     "aspectRatio" TEXT NOT NULL DEFAULT '9:16';

-- AddForeignKey
ALTER TABLE "ClipFolder" ADD CONSTRAINT "ClipFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ClipFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipMixerItem" ADD CONSTRAINT "ClipMixerItem_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "ClipFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
