-- Bulk Link Sourcing: SourcingRun / SourcedVideo / SourcedVideoAssignment.
-- The pre-existing YouTube-sourcing "SourcedVideo" model was renamed to
-- "YouTubeSourcedVideo" in the schema, so rename the table (and its
-- constraints/indexes) instead of dropping it — preserves all existing rows.
-- (_MigrationBackup_* tables are intentionally left untouched.)

-- RenameTable
ALTER TABLE "SourcedVideo" RENAME TO "YouTubeSourcedVideo";

-- Rename constraints / indexes to match the new model name
ALTER INDEX "SourcedVideo_pkey" RENAME TO "YouTubeSourcedVideo_pkey";
ALTER INDEX "SourcedVideo_sourceId_youtubeVideoId_key" RENAME TO "YouTubeSourcedVideo_sourceId_youtubeVideoId_key";
ALTER TABLE "YouTubeSourcedVideo" RENAME CONSTRAINT "SourcedVideo_sourceId_fkey" TO "YouTubeSourcedVideo_sourceId_fkey";
ALTER TABLE "YouTubeSourcedVideo" RENAME CONSTRAINT "SourcedVideo_nicheId_fkey" TO "YouTubeSourcedVideo_nicheId_fkey";

-- CreateTable
CREATE TABLE "SourcingRun" (
    "id" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linkCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DOWNLOADING',
    "summary" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "SourcingRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourcedVideo" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "normalizedUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "localPath" TEXT,
    "durationSec" DOUBLE PRECISION,
    "sizeBytes" BIGINT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourcedVideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourcedVideoAssignment" (
    "id" TEXT NOT NULL,
    "sourcedVideoId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "driveFolderId" TEXT NOT NULL,
    "driveFolderName" TEXT,
    "driveFileId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "uploadedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourcedVideoAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SourcedVideo_normalizedUrl_idx" ON "SourcedVideo"("normalizedUrl");

-- CreateIndex
CREATE INDEX "SourcedVideo_runId_status_idx" ON "SourcedVideo"("runId", "status");

-- CreateIndex
CREATE INDEX "SourcedVideoAssignment_sourcedVideoId_idx" ON "SourcedVideoAssignment"("sourcedVideoId");

-- CreateIndex
CREATE INDEX "SourcedVideoAssignment_accountId_idx" ON "SourcedVideoAssignment"("accountId");

-- AddForeignKey
ALTER TABLE "SourcedVideo" ADD CONSTRAINT "SourcedVideo_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SourcingRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcedVideoAssignment" ADD CONSTRAINT "SourcedVideoAssignment_sourcedVideoId_fkey" FOREIGN KEY ("sourcedVideoId") REFERENCES "SourcedVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
