-- CreateEnum
CREATE TYPE "GenreBatchStatus" AS ENUM ('DRAFT', 'QUOTES_GENERATING', 'QUOTES_REVIEW', 'RENDERING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "GenreBatchItemStatus" AS ENUM ('PENDING', 'GENERATED', 'CONFIRMED', 'RENDERING', 'RENDERED', 'UPLOADED', 'FAILED');

-- CreateTable
CREATE TABLE "Track" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "duration" DOUBLE PRECISION NOT NULL,
    "defaultStart" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "defaultDuration" DOUBLE PRECISION NOT NULL DEFAULT 7.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Track_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountGenreConfig" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "genre" TEXT NOT NULL DEFAULT 'quote',
    "themeText" TEXT NOT NULL,
    "fontFamily" TEXT NOT NULL DEFAULT 'Outfit-Bold',
    "fontSize" INTEGER NOT NULL DEFAULT 44,
    "fontColor" TEXT NOT NULL DEFAULT '#FFFFFF',
    "textCase" TEXT NOT NULL DEFAULT 'UPPERCASE',
    "boxColor" TEXT NOT NULL DEFAULT 'black@0.4',
    "shadowColor" TEXT NOT NULL DEFAULT 'black@0.6',
    "lineSpacing" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountGenreConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountBackgroundVideo" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "genre" TEXT NOT NULL DEFAULT 'quote',
    "videoUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountBackgroundVideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenreBatch" (
    "id" TEXT NOT NULL,
    "genre" TEXT NOT NULL DEFAULT 'quote',
    "status" "GenreBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "totalPosts" INTEGER NOT NULL,
    "postsPerAccount" INTEGER NOT NULL,
    "audioReuseMax" INTEGER NOT NULL DEFAULT 2,
    "videoLength" DOUBLE PRECISION NOT NULL DEFAULT 7.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GenreBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenreBatchItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "quoteText" TEXT NOT NULL,
    "quoteAuthor" TEXT,
    "trackId" TEXT NOT NULL,
    "trackStart" DOUBLE PRECISION NOT NULL,
    "backgroundVideoUrl" TEXT NOT NULL,
    "renderedVideoUrl" TEXT,
    "driveFileId" TEXT,
    "status" "GenreBatchItemStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GenreBatchItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountGenreConfig_accountId_genre_key" ON "AccountGenreConfig"("accountId", "genre");

-- AddForeignKey
ALTER TABLE "AccountGenreConfig" ADD CONSTRAINT "AccountGenreConfig_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ManagedAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountBackgroundVideo" ADD CONSTRAINT "AccountBackgroundVideo_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ManagedAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenreBatchItem" ADD CONSTRAINT "GenreBatchItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "GenreBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenreBatchItem" ADD CONSTRAINT "GenreBatchItem_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ManagedAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenreBatchItem" ADD CONSTRAINT "GenreBatchItem_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
