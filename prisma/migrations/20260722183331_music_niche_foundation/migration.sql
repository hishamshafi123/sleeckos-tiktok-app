-- AlterTable
ALTER TABLE "ManagedAccount" ADD COLUMN     "inputDriveFolderId" TEXT,
ADD COLUMN     "lastDriveSyncAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Track" ADD COLUMN     "audioRef" TEXT,
ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "lrcData" JSONB,
ADD COLUMN     "maxReuse" INTEGER,
ADD COLUMN     "trimEnd" DOUBLE PRECISION,
ADD COLUMN     "trimStart" DOUBLE PRECISION NOT NULL DEFAULT 0,
ALTER COLUMN "artist" DROP NOT NULL;

-- CreateTable
CREATE TABLE "DriveFile" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "driveFileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "size" BIGINT,
    "mimeType" TEXT,
    "timesUsed" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'unused',
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriveFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactoryBatch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "mixingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "variationStrength" INTEGER NOT NULL DEFAULT 3,
    "targetDuration" DOUBLE PRECISION NOT NULL DEFAULT 30,
    "campaignId" TEXT,
    "styleIds" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactoryBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactoryBatchItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "accountId" TEXT,
    "styleId" TEXT,
    "trackId" TEXT,
    "quoteText" TEXT,
    "recipe" JSONB,
    "recipeFingerprint" TEXT,
    "sourceDriveFileIds" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "outputRef" TEXT,
    "outputDriveFileId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactoryBatchItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OverlayCache" (
    "id" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "styleId" TEXT,
    "trackId" TEXT,
    "filePath" TEXT,
    "r2Key" TEXT,
    "readyAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OverlayCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "campaignId" TEXT,
    "batchId" TEXT,
    "videoCount" INTEGER NOT NULL,
    "fileList" JSONB NOT NULL DEFAULT '[]',
    "deliveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outputFolderId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'delivered',
    "postingMode" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryConfirmation" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "scheduledBy" TEXT,
    "postedCount" INTEGER,
    "postedAt" TIMESTAMP(3),
    "postedBy" TEXT,
    "note" TEXT,

    CONSTRAINT "DeliveryConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FontAsset" (
    "id" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "weights" INTEGER[],
    "files" JSONB NOT NULL,
    "license" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "FontAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DriveFile_accountId_timesUsed_idx" ON "DriveFile"("accountId", "timesUsed");

-- CreateIndex
CREATE UNIQUE INDEX "DriveFile_folderId_driveFileId_key" ON "DriveFile"("folderId", "driveFileId");

-- CreateIndex
CREATE INDEX "FactoryBatchItem_batchId_status_idx" ON "FactoryBatchItem"("batchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OverlayCache_hash_key" ON "OverlayCache"("hash");

-- CreateIndex
CREATE INDEX "Delivery_campaignId_deliveredAt_idx" ON "Delivery"("campaignId", "deliveredAt");

-- CreateIndex
CREATE INDEX "Delivery_accountId_status_idx" ON "Delivery"("accountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryConfirmation_deliveryId_key" ON "DeliveryConfirmation"("deliveryId");

-- CreateIndex
CREATE UNIQUE INDEX "FontAsset_family_key" ON "FontAsset"("family");

-- AddForeignKey
ALTER TABLE "DriveFile" ADD CONSTRAINT "DriveFile_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ManagedAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactoryBatchItem" ADD CONSTRAINT "FactoryBatchItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "FactoryBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactoryBatchItem" ADD CONSTRAINT "FactoryBatchItem_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryConfirmation" ADD CONSTRAINT "DeliveryConfirmation_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

