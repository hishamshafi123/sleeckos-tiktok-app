-- AlterTable
ALTER TABLE "ContentSource" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "includeAllPosts" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastPostAt" TIMESTAMP(3),
ADD COLUMN     "profileHandle" TEXT,
ADD COLUMN     "trackedPostCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ContentTrackedPost" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "stateCode" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "platformPostId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "mediaType" TEXT NOT NULL DEFAULT 'VIDEO',
    "duration" DOUBLE PRECISION,
    "publishedAt" TIMESTAMP(3),
    "views" BIGINT,
    "likes" BIGINT,
    "comments" BIGINT,
    "shares" BIGINT,
    "storyId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMetricsAt" TIMESTAMP(3),

    CONSTRAINT "ContentTrackedPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentTrackedPost_stateCode_platform_publishedAt_idx" ON "ContentTrackedPost"("stateCode", "platform", "publishedAt");

-- CreateIndex
CREATE INDEX "ContentTrackedPost_storyId_idx" ON "ContentTrackedPost"("storyId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentTrackedPost_sourceId_platformPostId_key" ON "ContentTrackedPost"("sourceId", "platformPostId");

-- CreateIndex
CREATE INDEX "ContentSource_archivedAt_enabled_nextRunAt_idx" ON "ContentSource"("archivedAt", "enabled", "nextRunAt");

-- AddForeignKey
ALTER TABLE "ContentTrackedPost" ADD CONSTRAINT "ContentTrackedPost_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ContentSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentTrackedPost" ADD CONSTRAINT "ContentTrackedPost_stateCode_fkey" FOREIGN KEY ("stateCode") REFERENCES "ContentState"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentTrackedPost" ADD CONSTRAINT "ContentTrackedPost_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "ContentStory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
