-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PostStatus" ADD VALUE 'CLAIMED';
ALTER TYPE "PostStatus" ADD VALUE 'PENDING_DELETION';
ALTER TYPE "PostStatus" ADD VALUE 'DELETED';

-- CreateTable
CREATE TABLE "PostJob" (
    "id" TEXT NOT NULL,
    "driveFileId" TEXT NOT NULL,
    "driveFileName" TEXT,
    "accountId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "tiktokPublishId" TEXT,
    "tiktokPostId" TEXT,
    "failureReason" TEXT,
    "publishedAt" TIMESTAMP(3),
    "deleteAfter" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PostJob_driveFileId_accountId_key" ON "PostJob"("driveFileId", "accountId");

-- AddForeignKey
ALTER TABLE "PostJob" ADD CONSTRAINT "PostJob_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ManagedAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
