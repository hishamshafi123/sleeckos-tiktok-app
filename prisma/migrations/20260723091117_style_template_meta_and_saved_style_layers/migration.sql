-- AlterTable
ALTER TABLE "SavedStyle" ADD COLUMN     "layers" JSONB;

-- AlterTable
ALTER TABLE "StyleTemplate" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'builtin',
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'published',
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

