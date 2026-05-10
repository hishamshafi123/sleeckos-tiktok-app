-- AlterTable
ALTER TABLE "ManagedAccount" ADD COLUMN "postTimeSlots" TEXT NOT NULL DEFAULT '12:00';

-- Migrate existing data: convert postTimeHour/postTimeMinute to postTimeSlots
UPDATE "ManagedAccount"
SET "postTimeSlots" = LPAD("postTimeHour"::text, 2, '0') || ':' || LPAD("postTimeMinute"::text, 2, '0');
