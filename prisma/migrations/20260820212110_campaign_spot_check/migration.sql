-- CreateTable
CREATE TABLE "CampaignSpotCheck" (
    "id" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "campaignIds" TEXT[],
    "sampleSize" INTEGER NOT NULL,
    "totalsJson" JSONB NOT NULL,
    "refreshedCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CampaignSpotCheck_pkey" PRIMARY KEY ("id")
);
