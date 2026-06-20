-- CreateTable
CREATE TABLE "LyricGeneration" (
    "id" TEXT NOT NULL,
    "songQuery" TEXT NOT NULL,
    "artistName" TEXT,
    "trackName" TEXT,
    "lrclibId" INTEGER,
    "youtubeVideoId" TEXT,
    "syncedLyrics" TEXT,
    "startLine" INTEGER NOT NULL DEFAULT 0,
    "endLine" INTEGER NOT NULL DEFAULT 0,
    "startTime" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "endTime" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "timedWords" TEXT,
    "audioFileUrl" TEXT,
    "trackId" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'lrclib',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LyricGeneration_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "LyricGeneration" ADD CONSTRAINT "LyricGeneration_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE SET NULL ON UPDATE CASCADE;
