-- AlterTable
ALTER TABLE "SavedStyle" ADD COLUMN     "family" TEXT NOT NULL DEFAULT 'lyric';

-- AlterTable
ALTER TABLE "StyleTemplate" ADD COLUMN     "isBase" BOOLEAN NOT NULL DEFAULT false;
