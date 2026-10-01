-- CreateTable
CREATE TABLE "AccountFeedEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "driveFolderId" TEXT,
    "source" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountFeedEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountFeedEvent_accountId_createdAt_idx" ON "AccountFeedEvent"("accountId", "createdAt");
