-- AlterTable
ALTER TABLE "AccountSection" ADD COLUMN     "descFixedText" TEXT,
ADD COLUMN     "descFixedTextEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "descTagCount" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "descTags" TEXT;
