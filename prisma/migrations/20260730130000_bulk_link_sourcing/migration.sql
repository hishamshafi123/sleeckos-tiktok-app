-- Bulk Link Sourcing: SourcingRun / SourcedVideo / SourcedVideoAssignment.
-- The pre-existing YouTube-sourcing "SourcedVideo" model was renamed to
-- "YouTubeSourcedVideo" in the schema, so rename the table (and its
-- constraints/indexes) instead of dropping it — preserves all existing rows.
-- (_MigrationBackup_* tables are intentionally left untouched.)

-- RenameTable (conditional — a previous partial run may have done it already)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'SourcedVideo')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'YouTubeSourcedVideo') THEN
    ALTER TABLE "SourcedVideo" RENAME TO "YouTubeSourcedVideo";
  END IF;
END $$;

-- Rename indexes to match the new model name (conditional)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'SourcedVideo_pkey') THEN
    ALTER INDEX "SourcedVideo_pkey" RENAME TO "YouTubeSourcedVideo_pkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'SourcedVideo_sourceId_youtubeVideoId_key') THEN
    ALTER INDEX "SourcedVideo_sourceId_youtubeVideoId_key" RENAME TO "YouTubeSourcedVideo_sourceId_youtubeVideoId_key";
  END IF;
END $$;

-- FK constraint names are cosmetic (Prisma doesn't reference them) and differ
-- across environments ("SV_source_fkey"/"SV_niche_fkey" on prod) — skip.

-- CreateTable
CREATE TABLE IF NOT EXISTS "SourcingRun" (
    "id" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linkCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DOWNLOADING',
    "summary" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "SourcingRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SourcedVideo" (
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
CREATE TABLE IF NOT EXISTS "SourcedVideoAssignment" (
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
CREATE INDEX IF NOT EXISTS "SourcedVideo_normalizedUrl_idx" ON "SourcedVideo"("normalizedUrl");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SourcedVideo_runId_status_idx" ON "SourcedVideo"("runId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SourcedVideoAssignment_sourcedVideoId_idx" ON "SourcedVideoAssignment"("sourcedVideoId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SourcedVideoAssignment_accountId_idx" ON "SourcedVideoAssignment"("accountId");

-- AddForeignKey
ALTER TABLE "SourcedVideo" ADD CONSTRAINT "SourcedVideo_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SourcingRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcedVideoAssignment" ADD CONSTRAINT "SourcedVideoAssignment_sourcedVideoId_fkey" FOREIGN KEY ("sourcedVideoId") REFERENCES "SourcedVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
