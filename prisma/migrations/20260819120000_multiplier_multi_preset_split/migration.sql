-- AlterTable
ALTER TABLE "MultiplierBatchJob" ADD COLUMN     "styleIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "MultiplierGroupVariation" ADD COLUMN     "styleId" TEXT;
