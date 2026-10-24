-- CreateTable
CREATE TABLE "GuardianCycle" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "inventoryComplete" BOOLEAN NOT NULL DEFAULT false,
    "runningCount" INTEGER NOT NULL DEFAULT 0,
    "stopRequested" INTEGER NOT NULL DEFAULT 0,
    "stopSucceeded" INTEGER NOT NULL DEFAULT 0,
    "stopFailed" INTEGER NOT NULL DEFAULT 0,
    "stopUnknown" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuardianCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuardianPhone" (
    "profileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tags" JSONB NOT NULL,
    "matchedTag" TEXT,
    "isRunning" BOOLEAN NOT NULL DEFAULT false,
    "status" INTEGER,
    "runningTimeSecs" INTEGER,
    "limitMinutes" DOUBLE PRECISION,
    "lastDecision" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "lastStoppedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuardianPhone_pkey" PRIMARY KEY ("profileId")
);

-- CreateTable
CREATE TABLE "GuardianStopEvent" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT,
    "sourceCycleId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "profileName" TEXT NOT NULL,
    "tags" JSONB NOT NULL,
    "matchedTag" TEXT,
    "runtimeSecs" INTEGER,
    "limitMinutes" DOUBLE PRECISION,
    "result" TEXT NOT NULL,
    "error" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuardianStopEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GuardianCycle_finishedAt_idx" ON "GuardianCycle"("finishedAt");

-- CreateIndex
CREATE INDEX "GuardianPhone_isRunning_lastSeenAt_idx" ON "GuardianPhone"("isRunning", "lastSeenAt");

-- CreateIndex
CREATE INDEX "GuardianPhone_name_idx" ON "GuardianPhone"("name");

-- CreateIndex
CREATE UNIQUE INDEX "GuardianStopEvent_sourceCycleId_profileId_key" ON "GuardianStopEvent"("sourceCycleId", "profileId");

-- CreateIndex
CREATE INDEX "GuardianStopEvent_createdAt_idx" ON "GuardianStopEvent"("createdAt");

-- CreateIndex
CREATE INDEX "GuardianStopEvent_occurredAt_idx" ON "GuardianStopEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "GuardianStopEvent_profileId_occurredAt_idx" ON "GuardianStopEvent"("profileId", "occurredAt");

-- CreateIndex
CREATE INDEX "GuardianStopEvent_result_occurredAt_idx" ON "GuardianStopEvent"("result", "occurredAt");

-- AddForeignKey
ALTER TABLE "GuardianStopEvent" ADD CONSTRAINT "GuardianStopEvent_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "GuardianCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
