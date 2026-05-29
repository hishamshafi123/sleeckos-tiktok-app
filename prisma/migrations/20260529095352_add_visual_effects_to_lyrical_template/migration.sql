-- AlterTable
ALTER TABLE "TrackLyricalTemplate" ADD COLUMN     "bgSpeed" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
ADD COLUMN     "colorFilter" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "mirrorBg" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "particleFx" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "vignette" TEXT NOT NULL DEFAULT 'none';
