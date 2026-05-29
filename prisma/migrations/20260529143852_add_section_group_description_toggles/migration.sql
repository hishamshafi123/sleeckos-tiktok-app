-- AlterTable
ALTER TABLE "AccountGroup" ADD COLUMN     "defaultDescription" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "AccountSection" ADD COLUMN     "defaultDescription" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;
