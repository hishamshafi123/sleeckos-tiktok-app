-- CreateTable
CREATE TABLE "ContentClip" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceName" TEXT NOT NULL,
    "sourcePath" TEXT,
    "duration" DOUBLE PRECISION,
    "transcript" JSONB,
    "transcriptVersion" INTEGER NOT NULL DEFAULT 0,
    "suggestions" JSONB,
    "draft" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentClip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentClipJob" (
    "id" TEXT NOT NULL,
    "clipId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "stage" TEXT NOT NULL DEFAULT 'Waiting for a worker',
    "error" TEXT,
    "payload" JSONB NOT NULL,
    "outputPath" TEXT,
    "owner" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentClipJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentClip_storyId_createdAt_idx" ON "ContentClip"("storyId", "createdAt");

-- CreateIndex
CREATE INDEX "ContentClipJob_status_createdAt_idx" ON "ContentClipJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ContentClipJob_clipId_createdAt_idx" ON "ContentClipJob"("clipId", "createdAt");

-- AddForeignKey
ALTER TABLE "ContentClip" ADD CONSTRAINT "ContentClip_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "ContentStory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentClipJob" ADD CONSTRAINT "ContentClipJob_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "ContentClip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
