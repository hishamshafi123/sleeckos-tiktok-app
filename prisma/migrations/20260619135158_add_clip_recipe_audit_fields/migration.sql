-- AlterTable
ALTER TABLE "ClipMixerBatch" ADD COLUMN     "variationStrength" INTEGER NOT NULL DEFAULT 3;

-- AlterTable
ALTER TABLE "ClipMixerItem" ADD COLUMN     "fingerprint" TEXT,
ADD COLUMN     "recipeJson" TEXT;
