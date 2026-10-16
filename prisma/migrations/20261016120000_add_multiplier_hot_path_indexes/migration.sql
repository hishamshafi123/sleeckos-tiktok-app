-- CreateIndex
CREATE INDEX "MultiplierOutput_status_createdAt_idx" ON "MultiplierOutput"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MultiplierOutput_groupId_idx" ON "MultiplierOutput"("groupId");

-- CreateIndex
CREATE INDEX "MultiplierOutput_exportStatus_idx" ON "MultiplierOutput"("exportStatus");

-- CreateIndex
CREATE INDEX "MultiplierGroup_status_idx" ON "MultiplierGroup"("status");

-- CreateIndex
CREATE INDEX "SmartExportAssignment_jobId_idx" ON "SmartExportAssignment"("jobId");

-- CreateIndex
CREATE INDEX "MultiplierBatchJobItem_jobId_idx" ON "MultiplierBatchJobItem"("jobId");
