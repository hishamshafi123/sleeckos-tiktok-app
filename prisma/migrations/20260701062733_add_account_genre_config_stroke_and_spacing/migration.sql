-- AlterTable
ALTER TABLE "AccountGenreConfig" ADD COLUMN     "letterSpacing" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "strokeColor" TEXT NOT NULL DEFAULT '#000000',
ADD COLUMN     "strokeEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "strokeWidth" INTEGER NOT NULL DEFAULT 0;
