import { toZonedTime } from "date-fns-tz";
import { startOfDay } from "date-fns";
import prisma from "@/lib/db";

export async function getOrgTimezone(): Promise<string> {
  const setting = await prisma.appSetting.findUnique({
    where: { key: "timezone" },
  });
  return setting?.value || "Asia/Kolkata";
}

export async function setOrgTimezone(tz: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: "timezone" },
    update: { value: tz },
    create: { key: "timezone", value: tz },
  });
}

/**
 * Converts a UTC Date to the start of the day (00:00:00) in the target timezone
 */
export function getZonedStartOfDay(utcDate: Date | string | number, timezone: string): Date {
  const date = new Date(utcDate);
  const zoned = toZonedTime(date, timezone);
  return startOfDay(zoned);
}

/**
 * Returns a YYYY-MM-DD date string of the timestamp in the target timezone
 */
export function getZonedDateString(utcDate: Date | string | number, timezone: string): string {
  const date = new Date(utcDate);
  const zoned = toZonedTime(date, timezone);
  const yyyy = zoned.getFullYear();
  const mm = String(zoned.getMonth() + 1).padStart(2, "0");
  const dd = String(zoned.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Returns a UTC Date matching the start of the day (00:00:00) of a future relative day in the target timezone
 */
export function getZonedFutureStartOfDay(timezone: string, daysOffset: number): Date {
  const { fromZonedTime } = require("date-fns-tz");
  const { addDays } = require("date-fns");
  const now = new Date();
  const zoned = toZonedTime(now, timezone);
  const futureZoned = addDays(zoned, daysOffset);
  const futureStartZoned = startOfDay(futureZoned);
  return fromZonedTime(futureStartZoned, timezone);
}
