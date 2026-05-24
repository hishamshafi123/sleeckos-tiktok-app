-- CreateEnum
CREATE TYPE "MultiplierBatchStatus" AS ENUM ('UPLOADING', 'READY', 'RENDERING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "MultiplierItemStatus" AS ENUM ('PENDING', 'RENDERING', 'RENDERED', 'FAILED');

-- CreateTable
CREATE TABLE "MultiplierBatch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "sourceVideoUrl" TEXT NOT NULL,
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "status" "MultiplierBatchStatus" NOT NULL DEFAULT 'UPLOADING',
    "fontFamily" TEXT NOT NULL DEFAULT 'Outfit-Bold',
    "fontSize" INTEGER NOT NULL DEFAULT 42,
    "fontColor" TEXT NOT NULL DEFAULT '#FFFFFF',
    "textCase" TEXT NOT NULL DEFAULT 'UPPERCASE',
    "bgStripColor" TEXT NOT NULL DEFAULT '#000000',
    "bgStripOpacity" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "textPosition" TEXT NOT NULL DEFAULT 'TOP',
    "stripPaddingY" INTEGER NOT NULL DEFAULT 20,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MultiplierBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MultiplierItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "hookText" TEXT NOT NULL,
    "renderedVideoUrl" TEXT,
    "status" "MultiplierItemStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MultiplierItem_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "MultiplierItem" ADD CONSTRAINT "MultiplierItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MultiplierBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
