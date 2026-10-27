/*
  Warnings:

  - A unique constraint covering the columns `[idempotencyKey]` on the table `SmartExportJob` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "SmartExportAssignment_jobId_idx";

-- DropIndex
DROP INDEX "SmartExportAssignment_status_idx";

-- AlterTable
ALTER TABLE "MultiplierOutput" ADD COLUMN     "renderHeartbeatAt" TIMESTAMP(3),
ADD COLUMN     "renderLeaseId" TEXT;

-- AlterTable
ALTER TABLE "SmartExportAssignment" ADD COLUMN     "uploadHeartbeatAt" TIMESTAMP(3),
ADD COLUMN     "uploadLeaseId" TEXT;

-- AlterTable
ALTER TABLE "SmartExportJob" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "requestHash" TEXT;

-- CreateIndex
CREATE INDEX "ManagedAccount_driveFolderId_idx" ON "ManagedAccount"("driveFolderId");

-- CreateIndex
CREATE INDEX "MultiplierOutput_status_renderHeartbeatAt_idx" ON "MultiplierOutput"("status", "renderHeartbeatAt");

-- CreateIndex
CREATE INDEX "MultiplierOutput_status_updatedAt_idx" ON "MultiplierOutput"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "MultiplierOutput_groupId_status_createdAt_idx" ON "MultiplierOutput"("groupId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SmartExportAssignment_status_id_idx" ON "SmartExportAssignment"("status", "id");

-- CreateIndex
CREATE INDEX "SmartExportAssignment_status_uploadHeartbeatAt_idx" ON "SmartExportAssignment"("status", "uploadHeartbeatAt");

-- CreateIndex
CREATE INDEX "SmartExportAssignment_status_updatedAt_idx" ON "SmartExportAssignment"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "SmartExportAssignment_jobId_status_idx" ON "SmartExportAssignment"("jobId", "status");

-- CreateIndex
CREATE INDEX "SmartExportAssignment_sourceGroupId_status_idx" ON "SmartExportAssignment"("sourceGroupId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SmartExportJob_idempotencyKey_key" ON "SmartExportJob"("idempotencyKey");
