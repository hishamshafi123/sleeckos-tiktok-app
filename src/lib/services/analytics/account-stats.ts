/**
 * AccountDailyStat rollup — one row per account per org-timezone (IST) day,
 * powering the Account Performance page so it never scans raw posts/snapshots.
 *
 * Conventions:
 *  - `date` is the UTC instant of IST midnight for the day (fromZonedTime).
 *  - postsCount: PostJobs in a terminal-published state with publishedAt
 *    inside the IST day.
 *  - viewsGained / likesGained: summed per-video deltas of VideoStatSnapshot —
 *    max(0, last snapshot that day − snapshot before it). A video with no
 *    previous snapshot contributes 0 (its first snapshot is a baseline, not a
 *    gain). Snapshot counters are BigInt; deltas are clamped to Int32.
 *
 * Everything here is idempotent: rows are upserted from source data, so the
 * backfill and the daily cron can be re-run safely.
 */

import prisma from "@/lib/db";
import { fromZonedTime } from "date-fns-tz";
import { getOrgTimezone, getZonedDateString } from "@/lib/services/timezone";

// Same set the sweep uses — a job that reached TikTok and was later deleted
// still counts as a post for that day.
export const TERMINAL_PUBLISHED_STATES = ["PUBLISHED", "PENDING_DELETION", "DELETED"];

const DAY_MS = 24 * 60 * 60 * 1000;
const INT32_MAX = 2_147_483_647;

/** UTC instants [start, end) bounding the given YYYY-MM-DD day in `timezone`. */
export function zonedDayBounds(istDate: string, timezone: string): { start: Date; end: Date } {
  const start = fromZonedTime(`${istDate}T00:00:00`, timezone);
  // IST has no DST; the next zoned midnight is still derived properly via
  // fromZonedTime on the next calendar day (addDays on the UTC-parsed date).
  const next = new Date(Date.parse(`${istDate}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
  const end = fromZonedTime(`${next}T00:00:00`, timezone);
  return { start, end };
}

/** YYYY-MM-DD of `date` in `timezone`. */
export function zonedDayString(date: Date, timezone: string): string {
  return getZonedDateString(date, timezone);
}

function clampInt(n: bigint): number {
  if (n < BigInt(0)) return 0;
  if (n > BigInt(INT32_MAX)) return INT32_MAX;
  return Number(n);
}

/**
 * Recompute and upsert the AccountDailyStat row for one account + one
 * YYYY-MM-DD (org timezone) day. Idempotent.
 */
export async function upsertAccountDailyStat(
  accountId: string,
  istDate: string,
  timezone?: string
): Promise<void> {
  const tz = timezone ?? (await getOrgTimezone());
  const { start, end } = zonedDayBounds(istDate, tz);

  const postsCount = await prisma.postJob.count({
    where: {
      accountId,
      state: { in: TERMINAL_PUBLISHED_STATES },
      publishedAt: { gte: start, lt: end },
    },
  });

  // Per-video delta: last snapshot of the day minus the one before it.
  const videos = await prisma.trackedVideo.findMany({
    where: { accountId },
    select: { id: true },
  });

  let viewsGained = 0;
  let likesGained = 0;
  for (const video of videos) {
    const lastTwo = await prisma.videoStatSnapshot.findMany({
      where: { trackedVideoId: video.id, recordedAt: { lt: end } },
      orderBy: { recordedAt: "desc" },
      take: 2,
      select: { views: true, likes: true, recordedAt: true },
    });
    const latest = lastTwo[0];
    const prev = lastTwo[1];
    if (!latest || latest.recordedAt < start || !prev) continue;
    viewsGained += clampInt(latest.views - prev.views);
    likesGained += clampInt(latest.likes - prev.likes);
  }

  await prisma.accountDailyStat.upsert({
    where: { accountId_date: { accountId, date: start } },
    create: { accountId, date: start, postsCount, viewsGained, likesGained },
    update: { postsCount, viewsGained, likesGained },
  });
}

/**
 * Daily cron entrypoint: upsert yesterday's rollup for every (non-revoked)
 * account, plus today's partial day so the "Today" period has live numbers.
 */
export async function rollupYesterday(): Promise<{ accounts: number; days: string[] }> {
  const tz = await getOrgTimezone();
  const today = zonedDayString(new Date(), tz);
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);

  const accounts = await prisma.managedAccount.findMany({
    where: { revokedAt: null },
    select: { id: true },
  });

  for (const account of accounts) {
    try {
      await upsertAccountDailyStat(account.id, yesterday, tz);
      await upsertAccountDailyStat(account.id, today, tz);
    } catch (err: any) {
      console.error(`[AccountStats] Rollup failed for account ${account.id}:`, err?.message || err);
    }
  }
  console.log(`[AccountStats] Rollup done: ${accounts.length} accounts × {${yesterday}, ${today}}`);
  return { accounts: accounts.length, days: [yesterday, today] };
}

/**
 * Rebuild the whole AccountDailyStat history from PostJob + VideoStatSnapshot.
 * One pass per account: snapshots are loaded once and consecutive-pair deltas
 * are bucketed into IST days in memory, then each touched day is upserted.
 */
export async function backfillAccountDailyStats(): Promise<{
  accounts: number;
  rowsUpserted: number;
}> {
  const tz = await getOrgTimezone();
  const accounts = await prisma.managedAccount.findMany({ select: { id: true } });

  let rowsUpserted = 0;
  for (const account of accounts) {
    try {
      // postsCount per IST day
      const jobs = await prisma.postJob.findMany({
        where: {
          accountId: account.id,
          state: { in: TERMINAL_PUBLISHED_STATES },
          publishedAt: { not: null },
        },
        select: { publishedAt: true },
      });
      const postsByDay = new Map<string, number>();
      for (const job of jobs) {
        const day = zonedDayString(job.publishedAt!, tz);
        postsByDay.set(day, (postsByDay.get(day) ?? 0) + 1);
      }

      // views/likes deltas per IST day from consecutive snapshot pairs
      const videos = await prisma.trackedVideo.findMany({
        where: { accountId: account.id },
        select: {
          id: true,
          snapshots: {
            orderBy: { recordedAt: "asc" },
            select: { views: true, likes: true, recordedAt: true },
          },
        },
      });
      const gainsByDay = new Map<string, { views: number; likes: number }>();
      for (const video of videos) {
        for (let i = 1; i < video.snapshots.length; i++) {
          const prev = video.snapshots[i - 1];
          const curr = video.snapshots[i];
          const day = zonedDayString(curr.recordedAt, tz);
          const agg = gainsByDay.get(day) ?? { views: 0, likes: 0 };
          agg.views += clampInt(curr.views - prev.views);
          agg.likes += clampInt(curr.likes - prev.likes);
          gainsByDay.set(day, agg);
        }
      }

      const days = new Set([...postsByDay.keys(), ...gainsByDay.keys()]);
      for (const day of days) {
        const { start } = zonedDayBounds(day, tz);
        const gains = gainsByDay.get(day);
        const data = {
          postsCount: postsByDay.get(day) ?? 0,
          viewsGained: gains?.views ?? 0,
          likesGained: gains?.likes ?? 0,
        };
        await prisma.accountDailyStat.upsert({
          where: { accountId_date: { accountId: account.id, date: start } },
          create: { accountId: account.id, date: start, ...data },
          update: data,
        });
        rowsUpserted++;
      }
    } catch (err: any) {
      console.error(`[AccountStats] Backfill failed for account ${account.id}:`, err?.message || err);
    }
  }
  console.log(`[AccountStats] Backfill done: ${accounts.length} accounts, ${rowsUpserted} rows`);
  return { accounts: accounts.length, rowsUpserted };
}
