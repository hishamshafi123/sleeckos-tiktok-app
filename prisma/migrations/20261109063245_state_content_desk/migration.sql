-- CreateTable
CREATE TABLE "ContentState" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keywords" TEXT NOT NULL,
    "excludedKeywords" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "dailyTarget" INTEGER NOT NULL DEFAULT 6,

    CONSTRAINT "ContentState_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "ContentSource" (
    "id" TEXT NOT NULL,
    "stateCode" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 60,
    "category" TEXT NOT NULL DEFAULT 'AUTO',
    "createdBy" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "pendingRunId" TEXT,
    "pendingSince" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentStory" (
    "id" TEXT NOT NULL,
    "stateCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'LOCAL',
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "score" INTEGER NOT NULL DEFAULT 0,
    "brief" JSONB,
    "briefError" TEXT,
    "briefAttempts" INTEGER NOT NULL DEFAULT 0,
    "briefNextAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evidenceHash" TEXT NOT NULL DEFAULT '',
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "teamId" TEXT,
    "accountId" TEXT,
    "selectedById" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "publishedUrl" TEXT,
    "postedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentStory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentItem" (
    "id" TEXT NOT NULL,
    "stateCode" TEXT NOT NULL,
    "sourceId" TEXT,
    "storyId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "publisher" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "coverage" TEXT NOT NULL DEFAULT 'EXCERPT',
    "views" BIGINT,
    "likes" BIGINT,
    "previousViews" BIGINT,
    "previousObservedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentEvent" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "userId" TEXT,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentRun" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "items" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "providerRunId" TEXT,
    "costUsd" DOUBLE PRECISION,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ContentRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContentState_name_key" ON "ContentState"("name");

-- CreateIndex
CREATE INDEX "ContentSource_enabled_nextRunAt_idx" ON "ContentSource"("enabled", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContentSource_stateCode_kind_url_key" ON "ContentSource"("stateCode", "kind", "url");

-- CreateIndex
CREATE INDEX "ContentStory_stateCode_status_createdAt_idx" ON "ContentStory"("stateCode", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ContentStory_teamId_status_idx" ON "ContentStory"("teamId", "status");

-- CreateIndex
CREATE INDEX "ContentItem_storyId_idx" ON "ContentItem"("storyId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentItem_stateCode_url_key" ON "ContentItem"("stateCode", "url");

-- CreateIndex
CREATE INDEX "ContentEvent_storyId_createdAt_idx" ON "ContentEvent"("storyId", "createdAt");

-- CreateIndex
CREATE INDEX "ContentRun_startedAt_idx" ON "ContentRun"("startedAt");

-- CreateIndex
CREATE INDEX "ContentRun_kind_startedAt_idx" ON "ContentRun"("kind", "startedAt");

-- AddForeignKey
ALTER TABLE "ContentSource" ADD CONSTRAINT "ContentSource_stateCode_fkey" FOREIGN KEY ("stateCode") REFERENCES "ContentState"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentStory" ADD CONSTRAINT "ContentStory_stateCode_fkey" FOREIGN KEY ("stateCode") REFERENCES "ContentState"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentStory" ADD CONSTRAINT "ContentStory_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "StateTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentStory" ADD CONSTRAINT "ContentStory_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "StateAccount"("accountId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentStory" ADD CONSTRAINT "ContentStory_selectedById_fkey" FOREIGN KEY ("selectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ContentSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "ContentStory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentEvent" ADD CONSTRAINT "ContentEvent_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "ContentStory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentRun" ADD CONSTRAINT "ContentRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ContentSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
