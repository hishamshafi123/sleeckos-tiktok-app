-- AlterTable (add maxSources to AccountSection)
ALTER TABLE "AccountSection" ADD COLUMN "maxSources" INTEGER NOT NULL DEFAULT 10;

-- CreateEnum
CREATE TYPE "YouTubeSourceType" AS ENUM ('CHANNEL', 'PLAYLIST');

-- CreateEnum
CREATE TYPE "SourcedVideoStatus" AS ENUM ('NEW', 'DOWNLOADED', 'CLIPPED', 'SKIPPED');

-- CreateTable
CREATE TABLE "YouTubeSource" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "type" "YouTubeSourceType" NOT NULL,
    "youtubeId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "thumbnailUrl" TEXT,
    "subscriberCount" INTEGER,
    "maxVideosPerFetch" INTEGER NOT NULL DEFAULT 10,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastFetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YouTubeSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourcedVideo" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "youtubeVideoId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "thumbnailUrl" TEXT NOT NULL,
    "channelTitle" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "duration" TEXT NOT NULL DEFAULT 'PT0S',
    "viewCount" BIGINT NOT NULL DEFAULT 0,
    "likeCount" BIGINT NOT NULL DEFAULT 0,
    "commentCount" BIGINT NOT NULL DEFAULT 0,
    "status" "SourcedVideoStatus" NOT NULL DEFAULT 'NEW',
    "downloadUrl" TEXT,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourcedVideo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "YouTubeSource_groupId_youtubeId_key" ON "YouTubeSource"("groupId", "youtubeId");

-- CreateIndex
CREATE UNIQUE INDEX "SourcedVideo_sourceId_youtubeVideoId_key" ON "SourcedVideo"("sourceId", "youtubeVideoId");

-- AddForeignKey
ALTER TABLE "YouTubeSource" ADD CONSTRAINT "YouTubeSource_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AccountGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcedVideo" ADD CONSTRAINT "SourcedVideo_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "YouTubeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcedVideo" ADD CONSTRAINT "SourcedVideo_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AccountGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
