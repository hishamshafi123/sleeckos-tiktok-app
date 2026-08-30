-- AlterTable
ALTER TABLE "FontAsset" ADD COLUMN     "slug" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'bundled';

-- CreateIndex
CREATE UNIQUE INDEX "FontAsset_slug_key" ON "FontAsset"("slug");
