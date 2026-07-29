
-- CreateTable
CREATE TABLE "TrackedVideo" (
    "id" TEXT NOT NULL,
    "tiktokVideoId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "campaignId" TEXT,
    "postJobId" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "captureMethod" TEXT NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'high',
    "status" TEXT NOT NULL DEFAULT 'captured',
    "captureAttempts" INTEGER NOT NULL DEFAULT 0,
    "views" BIGINT NOT NULL DEFAULT 0,
    "likes" BIGINT NOT NULL DEFAULT 0,
    "comments" BIGINT NOT NULL DEFAULT 0,
    "shares" BIGINT NOT NULL DEFAULT 0,
    "lastRefreshedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackedVideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoStatSnapshot" (
    "id" TEXT NOT NULL,
    "trackedVideoId" TEXT NOT NULL,
    "views" BIGINT NOT NULL,
    "likes" BIGINT NOT NULL,
    "comments" BIGINT NOT NULL,
    "shares" BIGINT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoStatSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsRun" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "attempted" INTEGER NOT NULL DEFAULT 0,
    "succeeded" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "cursor" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AnalyticsRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrackedVideo_tiktokVideoId_key" ON "TrackedVideo"("tiktokVideoId");

-- CreateIndex
CREATE INDEX "TrackedVideo_campaignId_idx" ON "TrackedVideo"("campaignId");

-- CreateIndex
CREATE INDEX "TrackedVideo_accountId_idx" ON "TrackedVideo"("accountId");

-- CreateIndex
CREATE INDEX "TrackedVideo_status_lastRefreshedAt_idx" ON "TrackedVideo"("status", "lastRefreshedAt");

-- CreateIndex
CREATE INDEX "VideoStatSnapshot_trackedVideoId_recordedAt_idx" ON "VideoStatSnapshot"("trackedVideoId", "recordedAt");

-- AddForeignKey
ALTER TABLE "VideoStatSnapshot" ADD CONSTRAINT "VideoStatSnapshot_trackedVideoId_fkey" FOREIGN KEY ("trackedVideoId") REFERENCES "TrackedVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- NOTE: the _MigrationBackup_* preservation tables intentionally survive this
-- migration (they back the admin migration-report worksheet).
