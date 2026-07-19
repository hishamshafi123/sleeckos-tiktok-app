-- AlterTable
ALTER TABLE "ManagedAccount" ADD COLUMN     "colorId" TEXT;

-- CreateTable
CREATE TABLE "AccountColor" (
    "id" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "meaning" TEXT NOT NULL,
    "defaultPostCount" INTEGER NOT NULL DEFAULT 1,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountColor_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ManagedAccount" ADD CONSTRAINT "ManagedAccount_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "AccountColor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
