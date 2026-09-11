/**
 * AccountDailyStat rollup — one row per account per org-timezone (IST) day,
 * powering the Account Performance page so it never scans raw posts/snapshots.
 *
 * Conventions:
 *  - `date` is the UTC instant of IST midnight for the day (fromZonedTime).
 *  - postsCount: PostJobs in a terminal-published state with publishedAt
 *    inside the IST day.
 *  - viewsGained / likesGained: summed per-video deltas of VideoStatSnapshot —
 *    max(0, last snapshot that day − snapshot before it). Additionally, a
 *    video's FIRST-ever snapshot counts in full on the video's POST day
 *    (publishedAt): views a video already had when its link was first captured
 *    are real views earned since the post went up, not a baseline to discard.
 *    Snapshot counters are BigInt; deltas are clamped to Int32.
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
    select: { id: true, publishedAt: true },
  });

  let viewsGained = 0;
  let likesGained = 0;
  for (const video of videos) {
    // Sum EVERY consecutive-pair delta inside the day (baseline = last
    // snapshot before the day). Taking just the last pair undercounts when
    // a video is snapshotted more than once in a day (capture + refresh +
    // sweep can all land on the same day).
    const prevBefore = await prisma.videoStatSnapshot.findFirst({
      where: { trackedVideoId: video.id, recordedAt: { lt: start } },
      orderBy: { recordedAt: "desc" },
      select: { views: true, likes: true },
    });
    const inDay = await prisma.videoStatSnapshot.findMany({
      where: { trackedVideoId: video.id, recordedAt: { gte: start, lt: end } },
      orderBy: { recordedAt: "asc" },
      select: { views: true, likes: true },
    });
    let prev = prevBefore;
    for (const snap of inDay) {
      if (prev) {
        viewsGained += clampInt(snap.views - prev.views);
        likesGained += clampInt(snap.likes - prev.likes);
      }
      prev = snap;
    }
    // First-snapshot rule: for videos POSTED this day, the first-ever
    // snapshot counts in full — those views accrued between publishing and
    // link capture and would otherwise vanish from every day's bar.
    if (video.publishedAt >= start && video.publishedAt < end) {
      const first = await prisma.videoStatSnapshot.findFirst({
        where: { trackedVideoId: video.id },
        orderBy: { recordedAt: "asc" },
        select: { views: true, likes: true },
      });
      if (first) {
        viewsGained += clampInt(first.views);
        likesGained += clampInt(first.likes);
      }
    }
  }

  await prisma.accountDailyStat.upsert({
    where: { accountId_date: { accountId, date: start } },
    create: { accountId, date: start, postsCount, viewsGained, likesGained },
    update: { postsCount, viewsGained, likesGained },
  });
}

/**
 * Recompute today's (and yesterday's) rollup for a specific set of accounts.
 * Called at the end of refresh/sweep passes so the Account Performance bars
 * move immediately after stats land — not only when the daily cron runs.
 * Idempotent (same upsert the cron uses).
 */
export async function rollupAccountsToday(accountIds: Iterable<string>): Promise<number> {
  const ids = [...new Set(accountIds)];
  if (ids.length === 0) return 0;
  const tz = await getOrgTimezone();
  const today = zonedDayString(new Date(), tz);
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);

  let done = 0;
  for (const id of ids) {
    try {
      await upsertAccountDailyStat(id, yesterday, tz);
      await upsertAccountDailyStat(id, today, tz);
      done++;
    } catch (err: any) {
      console.error(`[AccountStats] Rollup failed for account ${id}:`, err?.message || err);
    }
  }
  return done;
}

/**
 * Recompute the rollup for specific accounts on specific org-tz days
 * (YYYY-MM-DD). Used by capture paths: a newly captured video's
 * first-snapshot views land on its POST day, which may be several days
 * back — today/yesterday alone wouldn't pick that up.
 */
export async function rollupAccountsForDays(
  accountIds: Iterable<string>,
  days: Iterable<string>
): Promise<number> {
  const ids = [...new Set(accountIds)];
  const dayList = [...new Set(days)];
  if (ids.length === 0 || dayList.length === 0) return 0;
  const tz = await getOrgTimezone();
  let done = 0;
  for (const id of ids) {
    for (const day of dayList) {
      try {
        await upsertAccountDailyStat(id, day, tz);
        done++;
      } catch (err: any) {
        console.error(`[AccountStats] Rollup failed for account ${id} day ${day}:`, err?.message || err);
      }
    }
  }
  return done;
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
          publishedAt: true,
          snapshots: {
            orderBy: { recordedAt: "asc" },
            select: { views: true, likes: true, recordedAt: true },
          },
        },
      });
      const gainsByDay = new Map<string, { views: number; likes: number }>();
      for (const video of videos) {
        // First-ever snapshot counts in full on the video's POST day (same
        // rule as upsertAccountDailyStat) — views earned between publishing
        // and link capture.
        if (video.snapshots.length > 0) {
          const postDay = zonedDayString(video.publishedAt, tz);
          const agg = gainsByDay.get(postDay) ?? { views: 0, likes: 0 };
          agg.views += clampInt(video.snapshots[0].views);
          agg.likes += clampInt(video.snapshots[0].likes);
          gainsByDay.set(postDay, agg);
        }
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
