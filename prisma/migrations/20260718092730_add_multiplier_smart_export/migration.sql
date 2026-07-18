-- AlterTable
ALTER TABLE "MultiplierOutput" ADD COLUMN     "exportDestinationFolderId" TEXT,
ADD COLUMN     "exportStatus" TEXT NOT NULL DEFAULT 'not_exported';

-- CreateTable
CREATE TABLE "SmartExportJob" (
    "id" TEXT NOT NULL,
    "groupIds" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summary" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "SmartExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmartExportAssignment" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "sourceGroupId" TEXT NOT NULL,
    "driveFolderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,

    CONSTRAINT "SmartExportAssignment_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "SmartExportAssignment" ADD CONSTRAINT "SmartExportAssignment_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "SmartExportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmartExportAssignment" ADD CONSTRAINT "SmartExportAssignment_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "MultiplierOutput"("id") ON DELETE CASCADE ON UPDATE CASCADE;
