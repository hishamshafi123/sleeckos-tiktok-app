CREATE TABLE "ApiClient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ApiClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiClientKey" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ApiClientKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiClientCampaign" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiClientCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiClientKey_keyHash_key" ON "ApiClientKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiClientKey_clientId_idx" ON "ApiClientKey"("clientId");

-- CreateIndex
CREATE INDEX "ApiClientCampaign_campaignId_idx" ON "ApiClientCampaign"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiClientCampaign_clientId_campaignId_key" ON "ApiClientCampaign"("clientId", "campaignId");

-- AddForeignKey
ALTER TABLE "ApiClientKey" ADD CONSTRAINT "ApiClientKey_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ApiClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiClientCampaign" ADD CONSTRAINT "ApiClientCampaign_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ApiClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
