-- CreateTable
CREATE TABLE "StateTeam" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "postsTarget" INTEGER NOT NULL DEFAULT 3,
    "warmupTarget" INTEGER NOT NULL DEFAULT 35,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StateTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StateTeamMember" (
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "StateTeamMember_pkey" PRIMARY KEY ("teamId","userId")
);

-- CreateTable
CREATE TABLE "StateAccount" (
    "accountId" TEXT NOT NULL,
    "teamId" TEXT,
    "stateName" TEXT,
    "guardianProfileId" TEXT,
    "postsTarget" INTEGER,
    "warmupTarget" INTEGER,
    "lastSyncAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "syncError" TEXT,
    "followers" BIGINT,
    "profileLikes" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StateAccount_pkey" PRIMARY KEY ("accountId")
);

-- CreateTable
CREATE TABLE "StateReportingDay" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StateReportingDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StateAccountDay" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "guardianProfileId" TEXT,
    "dayId" TEXT NOT NULL,
    "teamId" TEXT,
    "postsTarget" INTEGER NOT NULL DEFAULT 0,
    "warmupTarget" INTEGER NOT NULL DEFAULT 0,
    "posts" INTEGER NOT NULL DEFAULT 0,
    "warmupMinutes" INTEGER NOT NULL DEFAULT 0,
    "views" BIGINT NOT NULL DEFAULT 0,
    "likes" BIGINT NOT NULL DEFAULT 0,
    "followerGrowth" BIGINT NOT NULL DEFAULT 0,
    "followersObserved" BOOLEAN NOT NULL DEFAULT false,
    "metricsObserved" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncAt" TIMESTAMP(3),

    CONSTRAINT "StateAccountDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StateVideo" (
    "videoId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "views" BIGINT NOT NULL,
    "likes" BIGINT NOT NULL,
    "lastObservedAt" TIMESTAMP(3) NOT NULL,
    "unavailable" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "StateVideo_pkey" PRIMARY KEY ("videoId")
);

-- CreateTable
CREATE TABLE "StateSyncLease" (
    "id" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StateSyncLease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuardianRuntimeSample" (
    "cycleId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "runtimeSecs" INTEGER NOT NULL,

    CONSTRAINT "GuardianRuntimeSample_pkey" PRIMARY KEY ("cycleId","profileId")
);

-- CreateIndex
CREATE UNIQUE INDEX "StateTeam_name_key" ON "StateTeam"("name");

-- CreateIndex
CREATE INDEX "StateTeamMember_userId_idx" ON "StateTeamMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StateAccount_guardianProfileId_key" ON "StateAccount"("guardianProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "StateReportingDay_startsAt_key" ON "StateReportingDay"("startsAt");

-- CreateIndex
CREATE INDEX "StateReportingDay_endsAt_idx" ON "StateReportingDay"("endsAt");

-- CreateIndex
CREATE INDEX "StateAccountDay_dayId_teamId_idx" ON "StateAccountDay"("dayId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "StateAccountDay_accountId_dayId_key" ON "StateAccountDay"("accountId", "dayId");

-- CreateIndex
CREATE INDEX "StateVideo_accountId_publishedAt_idx" ON "StateVideo"("accountId", "publishedAt");

-- CreateIndex
CREATE INDEX "GuardianRuntimeSample_profileId_observedAt_idx" ON "GuardianRuntimeSample"("profileId", "observedAt");

-- AddForeignKey
ALTER TABLE "StateTeamMember" ADD CONSTRAINT "StateTeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "StateTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StateTeamMember" ADD CONSTRAINT "StateTeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StateAccount" ADD CONSTRAINT "StateAccount_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ManagedAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StateAccount" ADD CONSTRAINT "StateAccount_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "StateTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StateAccount" ADD CONSTRAINT "StateAccount_guardianProfileId_fkey" FOREIGN KEY ("guardianProfileId") REFERENCES "GuardianPhone"("profileId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StateAccountDay" ADD CONSTRAINT "StateAccountDay_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "StateAccount"("accountId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StateAccountDay" ADD CONSTRAINT "StateAccountDay_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "StateReportingDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StateAccountDay" ADD CONSTRAINT "StateAccountDay_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "StateTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StateVideo" ADD CONSTRAINT "StateVideo_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "StateAccount"("accountId") ON DELETE CASCADE ON UPDATE CASCADE;
