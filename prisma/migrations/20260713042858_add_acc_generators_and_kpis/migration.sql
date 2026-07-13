-- AlterTable
ALTER TABLE "SheetColumn" ADD COLUMN     "trackConfig" JSONB;

-- AlterTable
ALTER TABLE "SheetRow" ADD COLUMN     "outcomeSetAt" TIMESTAMP(3),
ADD COLUMN     "outcomeStatus" TEXT;

-- AlterTable
ALTER TABLE "VaultFolder" ADD COLUMN     "ownerUserId" TEXT;

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AccountGenerationEvent" (
    "id" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "columnId" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "status" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "setByUserId" TEXT,

    CONSTRAINT "AccountGenerationEvent_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "VaultFolder" ADD CONSTRAINT "VaultFolder_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountGenerationEvent" ADD CONSTRAINT "AccountGenerationEvent_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountGenerationEvent" ADD CONSTRAINT "AccountGenerationEvent_setByUserId_fkey" FOREIGN KEY ("setByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
