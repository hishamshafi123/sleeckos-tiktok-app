-- AlterTable
ALTER TABLE "GenreBatchItem" ADD COLUMN     "muteAudio" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "TrackLyricalTemplate" ADD COLUMN     "muteAudio" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ClipFolder" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClipFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClipVideo" (
    "id" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "videoUrl" TEXT NOT NULL,
    "duration" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClipVideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClipMixerBatch" (
    "id" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "lyricalTemplateId" TEXT NOT NULL,
    "targetDuration" DOUBLE PRECISION NOT NULL DEFAULT 15.0,
    "totalVideos" INTEGER NOT NULL DEFAULT 5,
    "muteAudio" BOOLEAN NOT NULL DEFAULT false,
    "status" "GenreBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClipMixerBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClipMixerItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "renderedVideoUrl" TEXT,
    "status" "GenreBatchItemStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClipMixerItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClipFolder_sectionId_name_key" ON "ClipFolder"("sectionId", "name");

-- AddForeignKey
ALTER TABLE "ClipFolder" ADD CONSTRAINT "ClipFolder_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "AccountSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipVideo" ADD CONSTRAINT "ClipVideo_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "ClipFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipMixerBatch" ADD CONSTRAINT "ClipMixerBatch_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "ClipFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipMixerBatch" ADD CONSTRAINT "ClipMixerBatch_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipMixerBatch" ADD CONSTRAINT "ClipMixerBatch_lyricalTemplateId_fkey" FOREIGN KEY ("lyricalTemplateId") REFERENCES "TrackLyricalTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipMixerItem" ADD CONSTRAINT "ClipMixerItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ClipMixerBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipMixerItem" ADD CONSTRAINT "ClipMixerItem_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ManagedAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
