-- CreateEnum
CREATE TYPE "YouTubeSourceType" AS ENUM ('CHANNEL', 'PLAYLIST');

-- CreateEnum
CREATE TYPE "SourcedVideoStatus" AS ENUM ('NEW', 'DOWNLOADED', 'CLIPPED', 'SKIPPED');

-- CreateTable: SourcingNiche (independent content topic for video sourcing)
CREATE TABLE "SourcingNiche" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#ef4444',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourcingNiche_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SourcingNiche_slug_key" ON "SourcingNiche"("slug");

-- CreateTable: SourcingNicheAccount (join: which accounts belong to which niche)
CREATE TABLE "SourcingNicheAccount" (
    "nicheId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourcingNicheAccount_pkey" PRIMARY KEY ("nicheId","accountId")
);

-- CreateTable: YouTubeSource
CREATE TABLE "YouTubeSource" (
    "id" TEXT NOT NULL,
    "nicheId" TEXT NOT NULL,
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

-- CreateIndex
CREATE UNIQUE INDEX "YouTubeSource_nicheId_youtubeId_key" ON "YouTubeSource"("nicheId", "youtubeId");

-- CreateTable: SourcedVideo
CREATE TABLE "SourcedVideo" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "nicheId" TEXT NOT NULL,
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
CREATE UNIQUE INDEX "SourcedVideo_sourceId_youtubeVideoId_key" ON "SourcedVideo"("sourceId", "youtubeVideoId");

-- AddForeignKey
ALTER TABLE "SourcingNicheAccount" ADD CONSTRAINT "SourcingNicheAccount_nicheId_fkey" FOREIGN KEY ("nicheId") REFERENCES "SourcingNiche"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcingNicheAccount" ADD CONSTRAINT "SourcingNicheAccount_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ManagedAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YouTubeSource" ADD CONSTRAINT "YouTubeSource_nicheId_fkey" FOREIGN KEY ("nicheId") REFERENCES "SourcingNiche"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcedVideo" ADD CONSTRAINT "SourcedVideo_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "YouTubeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcedVideo" ADD CONSTRAINT "SourcedVideo_nicheId_fkey" FOREIGN KEY ("nicheId") REFERENCES "SourcingNiche"("id") ON DELETE CASCADE ON UPDATE CASCADE;
