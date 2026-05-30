-- AlterTable
ALTER TABLE "MultiplierBatch" ADD COLUMN     "driveExportStatus" TEXT,
ADD COLUMN     "driveFolderId" TEXT,
ADD COLUMN     "driveFolderName" TEXT;

-- CreateTable
CREATE TABLE "MultiplierTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hooks" TEXT NOT NULL,
    "hookCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MultiplierTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleDriveConnection" (
    "id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'multiplier',
    "googleEmail" TEXT,
    "googleAccessToken" TEXT,
    "googleRefreshToken" TEXT,
    "googleTokenExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleDriveConnection_pkey" PRIMARY KEY ("id")
);
