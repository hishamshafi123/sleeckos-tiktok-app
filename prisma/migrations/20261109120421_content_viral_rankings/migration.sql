-- CreateTable
CREATE TABLE "ContentRanking" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "hours" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "candidates" JSONB NOT NULL,
    "results" JSONB NOT NULL DEFAULT '[]',
    "total" INTEGER NOT NULL,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ContentRanking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentRanking_scope_createdAt_idx" ON "ContentRanking"("scope", "createdAt");

-- CreateIndex
CREATE INDEX "ContentRanking_status_updatedAt_idx" ON "ContentRanking"("status", "updatedAt");
