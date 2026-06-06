-- AlterTable
ALTER TABLE "TrackLyricalTemplate" ADD COLUMN     "animationMode" TEXT NOT NULL DEFAULT 'highlight',
ADD COLUMN     "bgColor" TEXT,
ADD COLUMN     "textColor" TEXT;
