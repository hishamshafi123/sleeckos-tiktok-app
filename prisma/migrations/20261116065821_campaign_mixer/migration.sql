-- AlterTable
ALTER TABLE "MultiplierGroup" ADD COLUMN     "sourceKind" TEXT NOT NULL DEFAULT 'legacy';

-- CreateTable
CREATE TABLE "MixerWorkspace" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT,
    "name" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "defaults" JSONB NOT NULL DEFAULT '{}',
    "draft" JSONB NOT NULL DEFAULT '{}',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MixerWorkspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MixerAsset" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "previewPath" TEXT,
    "thumbnailPath" TEXT,
    "duration" DOUBLE PRECISION NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "hasAudio" BOOLEAN NOT NULL DEFAULT false,
    "sizeBytes" INTEGER NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MixerAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MixerText" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "canonicalHash" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MixerText_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MixerPreset" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MixerPreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MixerBatch" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "groupId" TEXT,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "businessDay" TEXT NOT NULL,
    "requestedCount" INTEGER NOT NULL,
    "plan" JSONB NOT NULL,
    "planHash" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MixerBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MixerRecipe" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "outputId" TEXT,
    "recipeKey" TEXT NOT NULL,
    "activeKey" TEXT,
    "contentKey" TEXT NOT NULL,
    "clipId" TEXT NOT NULL,
    "musicId" TEXT NOT NULL,
    "textId" TEXT NOT NULL,
    "presetId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MixerRecipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MixerDelivery" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "recipeKey" TEXT NOT NULL,
    "accountId" TEXT,
    "driveFolderId" TEXT NOT NULL,
    "driveFileId" TEXT,
    "outputId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MixerDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MixerWorkspace_campaignId_key" ON "MixerWorkspace"("campaignId");

-- CreateIndex
CREATE INDEX "MixerAsset_workspaceId_archived_createdAt_idx" ON "MixerAsset"("workspaceId", "archived", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MixerAsset_workspaceId_kind_contentHash_key" ON "MixerAsset"("workspaceId", "kind", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "MixerText_workspaceId_canonicalHash_key" ON "MixerText"("workspaceId", "canonicalHash");

-- CreateIndex
CREATE UNIQUE INDEX "MixerBatch_groupId_key" ON "MixerBatch"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "MixerBatch_idempotencyKey_key" ON "MixerBatch"("idempotencyKey");

-- CreateIndex
CREATE INDEX "MixerBatch_workspaceId_createdAt_idx" ON "MixerBatch"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MixerRecipe_outputId_key" ON "MixerRecipe"("outputId");

-- CreateIndex
CREATE INDEX "MixerRecipe_batchId_status_idx" ON "MixerRecipe"("batchId", "status");

-- CreateIndex
CREATE INDEX "MixerRecipe_workspaceId_contentKey_idx" ON "MixerRecipe"("workspaceId", "contentKey");

-- CreateIndex
CREATE UNIQUE INDEX "MixerRecipe_workspaceId_activeKey_key" ON "MixerRecipe"("workspaceId", "activeKey");

-- CreateIndex
CREATE INDEX "MixerDelivery_outputId_idx" ON "MixerDelivery"("outputId");

-- CreateIndex
CREATE UNIQUE INDEX "MixerDelivery_workspaceId_recipeKey_driveFolderId_key" ON "MixerDelivery"("workspaceId", "recipeKey", "driveFolderId");

-- AddForeignKey
ALTER TABLE "MixerWorkspace" ADD CONSTRAINT "MixerWorkspace_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MixerAsset" ADD CONSTRAINT "MixerAsset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "MixerWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MixerText" ADD CONSTRAINT "MixerText_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "MixerWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MixerPreset" ADD CONSTRAINT "MixerPreset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "MixerWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MixerBatch" ADD CONSTRAINT "MixerBatch_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "MixerWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MixerBatch" ADD CONSTRAINT "MixerBatch_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "MultiplierGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MixerRecipe" ADD CONSTRAINT "MixerRecipe_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "MixerWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MixerRecipe" ADD CONSTRAINT "MixerRecipe_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MixerBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MixerRecipe" ADD CONSTRAINT "MixerRecipe_outputId_fkey" FOREIGN KEY ("outputId") REFERENCES "MultiplierOutput"("id") ON DELETE SET NULL ON UPDATE CASCADE;
