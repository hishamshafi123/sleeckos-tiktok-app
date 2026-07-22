-- AlterTable
ALTER TABLE "DriveFile" ALTER COLUMN "accountId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "FactoryBatch" ADD COLUMN     "quotes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "sourceFolderId" TEXT,
ADD COLUMN     "trackIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "FactoryBatchItem" ADD COLUMN     "distributedAt" TIMESTAMP(3),
ADD COLUMN     "distributedToAccountId" TEXT;
