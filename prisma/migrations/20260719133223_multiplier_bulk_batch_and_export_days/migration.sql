-- AlterTable
ALTER TABLE "MultiplierGroup" ALTER COLUMN "campaignId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "SmartExportJob" ADD COLUMN     "days" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "MultiplierBatchJob" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "campaignId" TEXT,
    "styleId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MultiplierBatchJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MultiplierBatchJobItem" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UPLOADING',
    "groupId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MultiplierBatchJobItem_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "MultiplierBatchJobItem" ADD CONSTRAINT "MultiplierBatchJobItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "MultiplierBatchJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
