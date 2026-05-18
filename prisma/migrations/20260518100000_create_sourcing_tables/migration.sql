-- CreateEnum (skip if already exists from a partial apply)
DO $$ BEGIN
  CREATE TYPE "YouTubeSourceType" AS ENUM ('CHANNEL', 'PLAYLIST');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "SourcedVideoStatus" AS ENUM ('NEW', 'DOWNLOADED', 'CLIPPED', 'SKIPPED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- CreateTable: SourcingNiche
CREATE TABLE IF NOT EXISTS "SourcingNiche" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#ef4444',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SourcingNiche_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SourcingNiche_slug_key" ON "SourcingNiche"("slug");

-- CreateTable: SourcingNicheAccount
CREATE TABLE IF NOT EXISTS "SourcingNicheAccount" (
    "nicheId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SourcingNicheAccount_pkey" PRIMARY KEY ("nicheId","accountId")
);

-- CreateTable: YouTubeSource
CREATE TABLE IF NOT EXISTS "YouTubeSource" (
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
CREATE UNIQUE INDEX IF NOT EXISTS "YouTubeSource_nicheId_youtubeId_key" ON "YouTubeSource"("nicheId", "youtubeId");

-- CreateTable: SourcedVideo
CREATE TABLE IF NOT EXISTS "SourcedVideo" (
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
CREATE UNIQUE INDEX IF NOT EXISTS "SourcedVideo_sourceId_youtubeVideoId_key" ON "SourcedVideo"("sourceId", "youtubeVideoId");

-- AddForeignKeys (IF NOT EXISTS via DO blocks)
DO $$ BEGIN
  ALTER TABLE "SourcingNicheAccount" ADD CONSTRAINT "SourcingNicheAccount_nicheId_fkey"
    FOREIGN KEY ("nicheId") REFERENCES "SourcingNiche"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "SourcingNicheAccount" ADD CONSTRAINT "SourcingNicheAccount_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "ManagedAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "YouTubeSource" ADD CONSTRAINT "YouTubeSource_nicheId_fkey"
    FOREIGN KEY ("nicheId") REFERENCES "SourcingNiche"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "SourcedVideo" ADD CONSTRAINT "SourcedVideo_sourceId_fkey"
    FOREIGN KEY ("sourceId") REFERENCES "YouTubeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "SourcedVideo" ADD CONSTRAINT "SourcedVideo_nicheId_fkey"
    FOREIGN KEY ("nicheId") REFERENCES "SourcingNiche"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
