-- CreateTable
CREATE TABLE "AccountPerformanceArchive" (
    "accountId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "driveFolderName" TEXT,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountPerformanceArchive_pkey" PRIMARY KEY ("accountId")
);

-- CreateTable
CREATE TABLE "AccountPerformanceArchiveDay" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "postsCount" INTEGER NOT NULL DEFAULT 0,
    "viewsGained" INTEGER NOT NULL DEFAULT 0,
    "likesGained" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountPerformanceArchiveDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountPerformanceArchiveDay_date_idx" ON "AccountPerformanceArchiveDay"("date");

-- CreateIndex
CREATE UNIQUE INDEX "AccountPerformanceArchiveDay_accountId_date_key" ON "AccountPerformanceArchiveDay"("accountId", "date");

-- AddForeignKey
ALTER TABLE "AccountPerformanceArchiveDay" ADD CONSTRAINT "AccountPerformanceArchiveDay_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "AccountPerformanceArchive"("accountId") ON DELETE CASCADE ON UPDATE CASCADE;
