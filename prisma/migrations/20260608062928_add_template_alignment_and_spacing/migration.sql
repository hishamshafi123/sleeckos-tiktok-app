-- AlterTable
ALTER TABLE "TrackLyricalTemplate" ADD COLUMN     "letterSpacing" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "textAlign" TEXT NOT NULL DEFAULT 'center',
ADD COLUMN     "wordSpacing" TEXT NOT NULL DEFAULT 'normal';
