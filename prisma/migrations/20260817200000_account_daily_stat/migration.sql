-- CreateTable
CREATE TABLE "AccountDailyStat" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "postsCount" INTEGER NOT NULL DEFAULT 0,
    "viewsGained" INTEGER NOT NULL DEFAULT 0,
    "likesGained" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountDailyStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountDailyStat_date_idx" ON "AccountDailyStat"("date");

-- CreateIndex
CREATE UNIQUE INDEX "AccountDailyStat_accountId_date_key" ON "AccountDailyStat"("accountId", "date");

-- AddForeignKey
ALTER TABLE "AccountDailyStat" ADD CONSTRAINT "AccountDailyStat_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ManagedAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
