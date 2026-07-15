-- AlterTable
ALTER TABLE "MultiplierBatch" ADD COLUMN     "googleEmail" TEXT;

-- AlterTable
ALTER TABLE "MultiplierItem" ADD COLUMN     "googleEmail" TEXT;

-- AlterTable
ALTER TABLE "MultiplierOutput" ADD COLUMN     "driveFolderName" TEXT,
ADD COLUMN     "googleEmail" TEXT;
