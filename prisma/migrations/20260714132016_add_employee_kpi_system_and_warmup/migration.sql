-- CreateTable
CREATE TABLE "FunctionAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "functionType" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FunctionAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KpiGoal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "functionType" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KpiGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "functionType" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "campaignId" TEXT,
    "source" TEXT NOT NULL,
    "meta" JSONB,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "approved" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarmupProtocol" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarmupProtocol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarmupEnrollment" (
    "id" TEXT NOT NULL,
    "managedAccountId" TEXT NOT NULL,
    "protocolId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "currentDay" INTEGER,
    "nextDueDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "assignedWarmerId" TEXT,
    "lastActionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarmupEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FunctionAssignment_userId_idx" ON "FunctionAssignment"("userId");

-- CreateIndex
CREATE INDEX "KpiGoal_userId_idx" ON "KpiGoal"("userId");

-- CreateIndex
CREATE INDEX "ActivityEvent_userId_idx" ON "ActivityEvent"("userId");

-- CreateIndex
CREATE INDEX "ActivityEvent_occurredAt_idx" ON "ActivityEvent"("occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "WarmupEnrollment_managedAccountId_key" ON "WarmupEnrollment"("managedAccountId");

-- CreateIndex
CREATE INDEX "WarmupEnrollment_assignedWarmerId_idx" ON "WarmupEnrollment"("assignedWarmerId");

-- AddForeignKey
ALTER TABLE "FunctionAssignment" ADD CONSTRAINT "FunctionAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiGoal" ADD CONSTRAINT "KpiGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarmupEnrollment" ADD CONSTRAINT "WarmupEnrollment_managedAccountId_fkey" FOREIGN KEY ("managedAccountId") REFERENCES "ManagedAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarmupEnrollment" ADD CONSTRAINT "WarmupEnrollment_protocolId_fkey" FOREIGN KEY ("protocolId") REFERENCES "WarmupProtocol"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarmupEnrollment" ADD CONSTRAINT "WarmupEnrollment_assignedWarmerId_fkey" FOREIGN KEY ("assignedWarmerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
