-- AlterTable
ALTER TABLE "AccountGenreConfig" ADD COLUMN     "curveText" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Track" ADD COLUMN     "campaignActiveAt" TIMESTAMP(3),
ADD COLUMN     "campaignOn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "genre" TEXT,
ADD COLUMN     "musician" TEXT;
