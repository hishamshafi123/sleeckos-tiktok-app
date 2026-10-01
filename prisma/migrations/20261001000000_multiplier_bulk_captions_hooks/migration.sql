-- AlterTable
ALTER TABLE "MultiplierBatchJob" ADD COLUMN     "hookCount" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "hooksEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "MultiplierGroup" ADD COLUMN     "caption" TEXT;

-- AlterTable
ALTER TABLE "MultiplierOutput" ADD COLUMN     "fixedCaption" TEXT;
