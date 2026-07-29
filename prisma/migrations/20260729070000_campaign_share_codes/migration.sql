-- CreateTable
CREATE TABLE "CampaignShare" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "CampaignShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignShare_code_key" ON "CampaignShare"("code");

-- CreateIndex
CREATE INDEX "CampaignShare_campaignId_idx" ON "CampaignShare"("campaignId");
