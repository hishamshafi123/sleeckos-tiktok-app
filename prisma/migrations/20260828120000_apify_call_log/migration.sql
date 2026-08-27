-- CreateTable
CREATE TABLE "ApifyCallLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "inputType" TEXT NOT NULL,
    "inputSummary" TEXT NOT NULL,
    "inputCount" INTEGER NOT NULL,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "apifyRunId" TEXT,
    "actorId" TEXT,
    "durationMs" INTEGER,
    "usageUsd" DOUBLE PRECISION,
    "chargedEventCounts" JSONB,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "errorKind" TEXT,

    CONSTRAINT "ApifyCallLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApifyCallLog_createdAt_idx" ON "ApifyCallLog"("createdAt");

-- CreateIndex
CREATE INDEX "ApifyCallLog_source_createdAt_idx" ON "ApifyCallLog"("source", "createdAt");
