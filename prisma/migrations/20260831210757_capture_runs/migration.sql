-- CreateTable
CREATE TABLE "CaptureRun" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT,
    "day" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "attempted" INTEGER NOT NULL DEFAULT 0,
    "captured" INTEGER NOT NULL DEFAULT 0,
    "unresolved" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "details" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaptureRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CaptureRun_campaignId_createdAt_idx" ON "CaptureRun"("campaignId", "createdAt");

-- AddForeignKey
ALTER TABLE "CaptureRun" ADD CONSTRAINT "CaptureRun_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
