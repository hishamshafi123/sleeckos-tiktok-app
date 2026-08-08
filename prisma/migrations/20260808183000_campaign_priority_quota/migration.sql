-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "priorityQuota" INTEGER,
ADD COLUMN     "priorityUsed" INTEGER NOT NULL DEFAULT 0;
