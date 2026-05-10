-- AlterTable: Make TikTok OAuth fields optional for PostPeer-only accounts
ALTER TABLE "ManagedAccount" ALTER COLUMN "tiktokOpenId" DROP NOT NULL;
ALTER TABLE "ManagedAccount" ALTER COLUMN "tiktokDisplayName" SET DEFAULT '';
ALTER TABLE "ManagedAccount" ALTER COLUMN "tiktokAvatarUrl" SET DEFAULT '';
ALTER TABLE "ManagedAccount" ALTER COLUMN "tiktokAccessToken" SET DEFAULT '';
ALTER TABLE "ManagedAccount" ALTER COLUMN "tiktokRefreshToken" SET DEFAULT '';
ALTER TABLE "ManagedAccount" ALTER COLUMN "tokenExpiresAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ManagedAccount" ALTER COLUMN "refreshTokenExpiresAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ManagedAccount" ALTER COLUMN "tiktokScopes" SET DEFAULT '';
