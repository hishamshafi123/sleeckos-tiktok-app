-- CreateTable
CREATE TABLE "AccountHealthScan" (
    "id" TEXT NOT NULL,
    "createdBy" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "thresholdsJson" JSONB NOT NULL DEFAULT '{}',
    "countsJson" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AccountHealthScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountHealthEntry" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "lastPostAt" TIMESTAMP(3),
    "recentPostsJson" JSONB NOT NULL DEFAULT '[]',
    "baselineViews" INTEGER,
    "assigneeId" TEXT,
    "replacementStatus" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountHealthEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountHealthEntry_scanId_verdict_idx" ON "AccountHealthEntry"("scanId", "verdict");

-- CreateIndex
CREATE INDEX "AccountHealthEntry_assigneeId_replacementStatus_idx" ON "AccountHealthEntry"("assigneeId", "replacementStatus");

-- CreateIndex
CREATE INDEX "AccountHealthEntry_accountId_idx" ON "AccountHealthEntry"("accountId");

-- AddForeignKey
ALTER TABLE "AccountHealthEntry" ADD CONSTRAINT "AccountHealthEntry_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "AccountHealthScan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountHealthEntry" ADD CONSTRAINT "AccountHealthEntry_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
