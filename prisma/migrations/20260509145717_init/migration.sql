-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CREATOR', 'BRAND_OWNER', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'APPROVED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "BrandCategory" AS ENUM ('BEAUTY', 'FASHION', 'FITNESS', 'FOOD', 'TECH', 'TRAVEL', 'LIFESTYLE', 'OTHER');

-- CreateEnum
CREATE TYPE "BrandStatus" AS ENUM ('PENDING', 'APPROVED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'OPEN', 'CLOSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "DeliverableStatus" AS ENUM ('BRIEFED', 'DRAFT_UPLOADED', 'DRAFT_APPROVED', 'DRAFT_NEEDS_CHANGES', 'READY_TO_PUBLISH', 'PUBLISHED', 'PAYOUT_PENDING', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('QUEUED', 'DOWNLOADING', 'UPLOADING', 'PROCESSING', 'PUBLISHED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'CREATOR',
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "bio" TEXT,
    "nicheTags" TEXT[],
    "followerCountSnapshot" INTEGER NOT NULL DEFAULT 0,
    "followerCountUpdatedAt" TIMESTAMP(3),
    "contentSampleUrls" TEXT[],
    "disclosureAgreedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "rejectionReason" TEXT,
    "stripeConnectAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TiktokAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "openId" TEXT NOT NULL,
    "unionId" TEXT,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "scopes" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "bioDescription" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "profileWebLink" TEXT,
    "profileDeepLink" TEXT,
    "followerCount" INTEGER NOT NULL DEFAULT 0,
    "followingCount" INTEGER NOT NULL DEFAULT 0,
    "likesCount" INTEGER NOT NULL DEFAULT 0,
    "videoCount" INTEGER NOT NULL DEFAULT 0,
    "statsUpdatedAt" TIMESTAMP(3),

    CONSTRAINT "TiktokAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT NOT NULL,
    "registrationNumber" TEXT,
    "website" TEXT NOT NULL,
    "category" "BrandCategory" NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "tiktokHandle" TEXT,
    "brandLogoUrl" TEXT,
    "status" "BrandStatus" NOT NULL DEFAULT 'PENDING',
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "rejectionReason" TEXT,
    "bannedCategoriesAcknowledged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "deliverableFormat" TEXT NOT NULL DEFAULT 'VIDEO',
    "deliverableCount" INTEGER NOT NULL DEFAULT 1,
    "requiredHashtags" TEXT[],
    "requiredMentions" TEXT[],
    "payoutPerPostCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "totalBudgetCents" INTEGER NOT NULL,
    "maxCreators" INTEGER NOT NULL,
    "applicationDeadline" TIMESTAMP(3) NOT NULL,
    "deliveryDeadline" TIMESTAMP(3) NOT NULL,
    "minFollowerCount" INTEGER NOT NULL DEFAULT 0,
    "nicheTags" TEXT[],
    "ageMinimum" INTEGER NOT NULL DEFAULT 18,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedByAdminAt" TIMESTAMP(3),
    "coverImageUrl" TEXT,
    "exampleVideos" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "creatorUserId" TEXT NOT NULL,
    "pitch" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "decisionAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deliverable" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "creatorUserId" TEXT NOT NULL,
    "status" "DeliverableStatus" NOT NULL DEFAULT 'BRIEFED',
    "draftVideoUrl" TEXT,
    "draftCaption" TEXT,
    "draftRevisionCount" INTEGER NOT NULL DEFAULT 0,
    "brandFeedback" TEXT,
    "publishId" TEXT,
    "tiktokVideoId" TEXT,
    "tiktokPostUrl" TEXT,
    "publishedAt" TIMESTAMP(3),
    "payoutAt" TIMESTAMP(3),
    "payoutStripeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deliverable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostMetric" (
    "id" TEXT NOT NULL,
    "deliverableId" TEXT NOT NULL,
    "viewCount" BIGINT NOT NULL DEFAULT 0,
    "likeCount" BIGINT NOT NULL DEFAULT 0,
    "commentCount" BIGINT NOT NULL DEFAULT 0,
    "shareCount" BIGINT NOT NULL DEFAULT 0,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountSection" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#8b5cf6',
    "icon" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountGroup" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagedAccount" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "tiktokOpenId" TEXT NOT NULL,
    "tiktokUnionId" TEXT,
    "tiktokUsername" TEXT NOT NULL,
    "tiktokDisplayName" TEXT NOT NULL,
    "tiktokAvatarUrl" TEXT NOT NULL,
    "tiktokAccessToken" TEXT NOT NULL,
    "tiktokRefreshToken" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "tiktokScopes" TEXT NOT NULL,
    "followerCount" INTEGER NOT NULL DEFAULT 0,
    "followingCount" INTEGER NOT NULL DEFAULT 0,
    "likesCount" INTEGER NOT NULL DEFAULT 0,
    "videoCount" INTEGER NOT NULL DEFAULT 0,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "statsUpdatedAt" TIMESTAMP(3),
    "driveFolderId" TEXT,
    "driveFolderName" TEXT,
    "driveConnected" BOOLEAN NOT NULL DEFAULT false,
    "postTimeHour" INTEGER NOT NULL DEFAULT 12,
    "postTimeMinute" INTEGER NOT NULL DEFAULT 0,
    "postTimezone" TEXT NOT NULL DEFAULT 'UTC',
    "postDays" TEXT NOT NULL DEFAULT '1,2,3,4,5,6,7',
    "postMode" TEXT NOT NULL DEFAULT 'DIRECT',
    "defaultCaption" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "captionSource" TEXT NOT NULL DEFAULT 'FILENAME',
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagedAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledPost" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "driveFileId" TEXT,
    "driveFileName" TEXT,
    "videoUrl" TEXT,
    "caption" TEXT NOT NULL DEFAULT '',
    "hashtags" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "PostStatus" NOT NULL DEFAULT 'QUEUED',
    "tiktokPublishId" TEXT,
    "tiktokVideoId" TEXT,
    "tiktokPostUrl" TEXT,
    "publishedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "viewCount" BIGINT NOT NULL DEFAULT 0,
    "likeCount" BIGINT NOT NULL DEFAULT 0,
    "commentCount" BIGINT NOT NULL DEFAULT 0,
    "shareCount" BIGINT NOT NULL DEFAULT 0,
    "metricsUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountDailyAnalytics" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "followerCount" INTEGER NOT NULL DEFAULT 0,
    "followingCount" INTEGER NOT NULL DEFAULT 0,
    "likesCount" INTEGER NOT NULL DEFAULT 0,
    "videoCount" INTEGER NOT NULL DEFAULT 0,
    "postsToday" INTEGER NOT NULL DEFAULT 0,
    "totalViews" BIGINT NOT NULL DEFAULT 0,
    "totalLikes" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "AccountDailyAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleCredential" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorProfile_userId_key" ON "CreatorProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TiktokAccount_userId_key" ON "TiktokAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TiktokAccount_openId_key" ON "TiktokAccount"("openId");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_ownerUserId_key" ON "Brand"("ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_slug_key" ON "Campaign"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Application_campaignId_creatorUserId_key" ON "Application"("campaignId", "creatorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Deliverable_applicationId_key" ON "Deliverable"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountSection_name_key" ON "AccountSection"("name");

-- CreateIndex
CREATE UNIQUE INDEX "AccountSection_slug_key" ON "AccountSection"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "AccountGroup_sectionId_slug_key" ON "AccountGroup"("sectionId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "ManagedAccount_tiktokOpenId_key" ON "ManagedAccount"("tiktokOpenId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountDailyAnalytics_accountId_date_key" ON "AccountDailyAnalytics"("accountId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleCredential_adminUserId_key" ON "GoogleCredential"("adminUserId");

-- AddForeignKey
ALTER TABLE "CreatorProfile" ADD CONSTRAINT "CreatorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorProfile" ADD CONSTRAINT "CreatorProfile_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TiktokAccount" ADD CONSTRAINT "TiktokAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deliverable" ADD CONSTRAINT "Deliverable_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deliverable" ADD CONSTRAINT "Deliverable_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deliverable" ADD CONSTRAINT "Deliverable_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostMetric" ADD CONSTRAINT "PostMetric_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "Deliverable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountGroup" ADD CONSTRAINT "AccountGroup_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "AccountSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagedAccount" ADD CONSTRAINT "ManagedAccount_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AccountGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledPost" ADD CONSTRAINT "ScheduledPost_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ManagedAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountDailyAnalytics" ADD CONSTRAINT "AccountDailyAnalytics_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ManagedAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
