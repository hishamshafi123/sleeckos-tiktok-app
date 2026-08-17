/**
 * Read-side services for the Account Performance page. All functions are
 * permission-checked (tool key "analytics", same as the Analytics dashboard)
 * and read from the AccountDailyStat rollup — never raw posts/snapshots on
 * the hot path (zeroViewStreak and lastPostAt are the documented exceptions;
 * both are single bounded queries).
 */

import prisma from "@/lib/db";
import { can } from "@/lib/services/permissions";
import { getOrgTimezone } from "@/lib/services/timezone";
import {
  TERMINAL_PUBLISHED_STATES,
  zonedDayBounds,
  zonedDayString,
} from "@/lib/services/analytics/account-stats";

const DAY_MS = 24 * 60 * 60 * 1000;
const ZERO_VIEW_THRESHOLD = 10; // views below this count as "zero-view"
const FLAG_STREAK = 5; // streak at/above this flags the account
// Window for the streak scan. An account with nothing newer is quiet, so its
// streak is reported as 0 (it shows up under Silent/Unused instead).
const STREAK_SCAN_DAYS = 90;

export class ForbiddenError extends Error {
  constructor() {
    super("Forbidden");
    this.name = "ForbiddenError";
  }
}

async function assertAccess(userId: string): Promise<void> {
  if (!(await can(userId, "analytics"))) throw new ForbiddenError();
}

export type PerformancePeriod = "today" | "yesterday" | "7d" | "30d";

/** [fromDay, toDay] inclusive YYYY-MM-DD range for a period, in `tz`. */
function periodRange(period: PerformancePeriod, tz: string, now = new Date()): { fromDay: string; toDay: string } {
  const today = zonedDayString(now, tz);
  const shift = (days: number) =>
    new Date(Date.parse(`${today}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
  switch (period) {
    case "today":
      return { fromDay: today, toDay: today };
    case "yesterday":
      return { fromDay: shift(-1), toDay: shift(-1) };
    case "7d":
      return { fromDay: shift(-6), toDay: today };
    case "30d":
      return { fromDay: shift(-29), toDay: today };
  }
}

/**
 * zeroViewStreak per account: newest-first captured TrackedVideos, counting
 * leading videos with views < ZERO_VIEW_THRESHOLD. One bounded query over the
 * last STREAK_SCAN_DAYS days, grouped in memory.
 */
async function computeZeroViewStreaks(accountIds: string[]): Promise<Map<string, number>> {
  const since = new Date(Date.now() - STREAK_SCAN_DAYS * DAY_MS);
  const videos = await prisma.trackedVideo.findMany({
    where: { accountId: { in: accountIds }, status: "captured", publishedAt: { gte: since } },
    orderBy: { publishedAt: "desc" },
    select: { accountId: true, views: true },
  });
  const streaks = new Map<string, number>();
  const done = new Set<string>();
  for (const v of videos) {
    if (done.has(v.accountId)) continue;
    if (v.views < BigInt(ZERO_VIEW_THRESHOLD)) {
      streaks.set(v.accountId, (streaks.get(v.accountId) ?? 0) + 1);
    } else {
      done.add(v.accountId);
    }
  }
  return streaks;
}

/** Max publishedAt per account (terminal-published PostJobs). */
async function computeLastPostAt(accountIds: string[]): Promise<Map<string, Date>> {
  const rows = await prisma.postJob.groupBy({
    by: ["accountId"],
    where: {
      accountId: { in: accountIds },
      state: { in: TERMINAL_PUBLISHED_STATES },
      publishedAt: { not: null },
    },
    _max: { publishedAt: true },
  });
  const map = new Map<string, Date>();
  for (const r of rows) if (r._max.publishedAt) map.set(r.accountId, r._max.publishedAt);
  return map;
}

export interface AccountPerformanceRow {
  accountId: string;
  accountName: string;
  driveFolderName: string | null;
  color: string;
  connectionState: string;
  posts: number;
  viewsGained: number;
  likesGained: number;
  avgViewsPerPost: number;
  zeroViewStreak: number;
  flagged: boolean;
  lastPostAt: string | null;
  sparkline: number[]; // last 7 IST days viewsGained, oldest first
}

export async function getAccountPerformance(
  userId: string,
  opts: {
    period: PerformancePeriod;
    campaignId?: string;
    flaggedOnly?: boolean;
    query?: string;
  }
): Promise<{ period: PerformancePeriod; fromDay: string; toDay: string; rows: AccountPerformanceRow[] }> {
  await assertAccess(userId);
  const tz = await getOrgTimezone();
  const { fromDay, toDay } = periodRange(opts.period, tz);
  const { start } = zonedDayBounds(fromDay, tz);
  const { end } = zonedDayBounds(toDay, tz);

  // Campaign filter: restricts the account set to accounts that posted for
  // this campaign in the period. Stats stay account-wide rollup numbers
  // (AccountDailyStat is per-account, not per-campaign) — documented behavior.
  let campaignAccountIds: Set<string> | null = null;
  if (opts.campaignId) {
    const rows = await prisma.postJob.findMany({
      where: {
        campaignId: opts.campaignId,
        state: { in: TERMINAL_PUBLISHED_STATES },
        publishedAt: { gte: start, lt: end },
      },
      select: { accountId: true },
      distinct: ["accountId"],
    });
    campaignAccountIds = new Set(rows.map((r) => r.accountId));
  }

  const accounts = await prisma.managedAccount.findMany({
    where: campaignAccountIds ? { id: { in: [...campaignAccountIds] } } : undefined,
    select: {
      id: true,
      tiktokUsername: true,
      driveFolderName: true,
      color: true,
      connectionState: true,
    },
  });

  const q = opts.query?.trim().toLowerCase();
  const filtered = q
    ? accounts.filter(
        (a) =>
          a.tiktokUsername.toLowerCase().includes(q) ||
          (a.driveFolderName ?? "").toLowerCase().includes(q)
      )
    : accounts;
  const accountIds = filtered.map((a) => a.id);

  if (accountIds.length === 0) {
    return { period: opts.period, fromDay, toDay, rows: [] };
  }

  // Rollup aggregates for the period + last-7-days sparkline source.
  const sparkStart = zonedDayBounds(
    new Date(Date.parse(`${toDay}T00:00:00Z`) - 6 * DAY_MS).toISOString().slice(0, 10),
    tz
  ).start;
  const [stats, sparkRows, streaks, lastPosts] = await Promise.all([
    prisma.accountDailyStat.groupBy({
      by: ["accountId"],
      where: { accountId: { in: accountIds }, date: { gte: start, lt: end } },
      _sum: { postsCount: true, viewsGained: true, likesGained: true },
    }),
    prisma.accountDailyStat.findMany({
      where: { accountId: { in: accountIds }, date: { gte: sparkStart, lt: end } },
      select: { accountId: true, date: true, viewsGained: true },
    }),
    computeZeroViewStreaks(accountIds),
    computeLastPostAt(accountIds),
  ]);

  const statsByAccount = new Map(stats.map((s) => [s.accountId, s._sum]));
  const sparkByAccount = new Map<string, Map<string, number>>();
  for (const r of sparkRows) {
    const day = zonedDayString(r.date, tz);
    const m = sparkByAccount.get(r.accountId) ?? new Map<string, number>();
    m.set(day, r.viewsGained);
    sparkByAccount.set(r.accountId, m);
  }
  const sparkDays = Array.from({ length: 7 }, (_, i) =>
    new Date(Date.parse(`${toDay}T00:00:00Z`) - (6 - i) * DAY_MS).toISOString().slice(0, 10)
  );

  let rows: AccountPerformanceRow[] = filtered.map((a) => {
    const sum = statsByAccount.get(a.id);
    const posts = sum?.postsCount ?? 0;
    const viewsGained = sum?.viewsGained ?? 0;
    const streak = streaks.get(a.id) ?? 0;
    const spark = sparkByAccount.get(a.id);
    return {
      accountId: a.id,
      accountName: a.tiktokUsername,
      driveFolderName: a.driveFolderName,
      color: a.color,
      connectionState: a.connectionState,
      posts,
      viewsGained,
      likesGained: sum?.likesGained ?? 0,
      avgViewsPerPost: posts > 0 ? Math.round(viewsGained / posts) : 0,
      zeroViewStreak: streak,
      flagged: streak >= FLAG_STREAK,
      lastPostAt: lastPosts.get(a.id)?.toISOString() ?? null,
      sparkline: sparkDays.map((d) => spark?.get(d) ?? 0),
    };
  });

  rows.sort((a, b) => b.viewsGained - a.viewsGained);
  if (opts.flaggedOnly) rows = rows.filter((r) => r.flagged);

  return { period: opts.period, fromDay, toDay, rows };
}

export interface PerformanceOverview {
  totalAccounts: number;
  activeAccounts: number; // posted in the last 24h
  postsYesterday: number;
  viewsYesterday: number;
  silentAccounts: number; // last post 1–2 IST days ago
  unusedAccounts: number; // last post 3+ IST days ago, or never posted
  flaggedAccounts: number; // zeroViewStreak >= FLAG_STREAK
}

export async function getPerformanceOverview(userId: string): Promise<PerformanceOverview> {
  await assertAccess(userId);
  const tz = await getOrgTimezone();
  const today = zonedDayString(new Date(), tz);
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
  const { start: yesterdayStart } = zonedDayBounds(yesterday, tz);
  const { start: todayStart } = zonedDayBounds(today, tz);
  const last24h = new Date(Date.now() - DAY_MS);

  const accounts = await prisma.managedAccount.findMany({ select: { id: true } });
  const accountIds = accounts.map((a) => a.id);

  const [activeRows, yesterdayAgg, lastPosts, streaks] = await Promise.all([
    prisma.postJob.findMany({
      where: {
        state: { in: TERMINAL_PUBLISHED_STATES },
        publishedAt: { gte: last24h },
      },
      select: { accountId: true },
      distinct: ["accountId"],
    }),
    prisma.accountDailyStat.aggregate({
      where: { date: yesterdayStart },
      _sum: { postsCount: true, viewsGained: true },
    }),
    computeLastPostAt(accountIds),
    computeZeroViewStreaks(accountIds),
  ]);

  let silent = 0;
  let unused = 0;
  for (const id of accountIds) {
    const last = lastPosts.get(id);
    if (!last) {
      unused++;
      continue;
    }
    // Whole IST days between the last post's day and today.
    const lastDay = zonedDayString(last, tz);
    const daysQuiet = Math.round(
      (todayStart.getTime() - zonedDayBounds(lastDay, tz).start.getTime()) / DAY_MS
    );
    if (daysQuiet >= 3) unused++;
    else if (daysQuiet >= 1) silent++;
  }

  let flagged = 0;
  for (const n of streaks.values()) if (n >= FLAG_STREAK) flagged++;

  return {
    totalAccounts: accountIds.length,
    activeAccounts: activeRows.length,
    postsYesterday: yesterdayAgg._sum.postsCount ?? 0,
    viewsYesterday: yesterdayAgg._sum.viewsGained ?? 0,
    silentAccounts: silent,
    unusedAccounts: unused,
    flaggedAccounts: flagged,
  };
}

export interface PostingCoverage {
  days: string[]; // YYYY-MM-DD, oldest first
  accounts: {
    accountId: string;
    accountName: string;
    driveFolderName: string | null;
    cells: Record<string, number>; // day → posts
  }[];
  silent: { accountId: string; accountName: string; daysQuiet: number }[];
  unused: { accountId: string; accountName: string; daysQuiet: number | null }[]; // null = never posted
}

export async function getPostingCoverage(userId: string, days = 7): Promise<PostingCoverage> {
  await assertAccess(userId);
  const tz = await getOrgTimezone();
  const today = zonedDayString(new Date(), tz);
  const dayList = Array.from({ length: days }, (_, i) =>
    new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10)
  );
  const { start } = zonedDayBounds(dayList[0], tz);
  const { start: todayStart } = zonedDayBounds(today, tz);

  const accounts = await prisma.managedAccount.findMany({
    select: { id: true, tiktokUsername: true, driveFolderName: true },
    orderBy: { tiktokUsername: "asc" },
  });
  const accountIds = accounts.map((a) => a.id);

  const [jobs, lastPosts] = await Promise.all([
    prisma.postJob.findMany({
      where: {
        accountId: { in: accountIds },
        state: { in: TERMINAL_PUBLISHED_STATES },
        publishedAt: { gte: start },
      },
      select: { accountId: true, publishedAt: true },
    }),
    computeLastPostAt(accountIds),
  ]);

  const cellsByAccount = new Map<string, Record<string, number>>();
  for (const job of jobs) {
    const day = zonedDayString(job.publishedAt!, tz);
    const cells = cellsByAccount.get(job.accountId) ?? {};
    cells[day] = (cells[day] ?? 0) + 1;
    cellsByAccount.set(job.accountId, cells);
  }

  const silent: PostingCoverage["silent"] = [];
  const unused: PostingCoverage["unused"] = [];
  for (const a of accounts) {
    const last = lastPosts.get(a.id);
    if (!last) {
      unused.push({ accountId: a.id, accountName: a.tiktokUsername, daysQuiet: null });
      continue;
    }
    const daysQuiet = Math.round(
      (todayStart.getTime() - zonedDayBounds(zonedDayString(last, tz), tz).start.getTime()) / DAY_MS
    );
    if (daysQuiet >= 3) {
      unused.push({ accountId: a.id, accountName: a.tiktokUsername, daysQuiet });
    } else if (daysQuiet >= 1) {
      silent.push({ accountId: a.id, accountName: a.tiktokUsername, daysQuiet });
    }
  }
  silent.sort((a, b) => b.daysQuiet - a.daysQuiet || a.accountName.localeCompare(b.accountName));
  unused.sort(
    (a, b) => (b.daysQuiet ?? Number.MAX_SAFE_INTEGER) - (a.daysQuiet ?? Number.MAX_SAFE_INTEGER)
  );

  return {
    days: dayList,
    accounts: accounts.map((a) => ({
      accountId: a.id,
      accountName: a.tiktokUsername,
      driveFolderName: a.driveFolderName,
      cells: cellsByAccount.get(a.id) ?? {},
    })),
    silent,
    unused,
  };
}

export interface Trajectory {
  days: { day: string; views: number }[]; // last 28 IST days
  last7Avg: number;
  prev7Avg: number;
  growthRate: number; // 7d-over-7d rate, e.g. 0.25 = +25%
  projections: {
    next7: { conservative: number; current: number; optimistic: number };
    next30: { conservative: number; current: number; optimistic: number };
  };
}

export async function getTrajectory(userId: string): Promise<Trajectory> {
  await assertAccess(userId);
  const tz = await getOrgTimezone();
  const today = zonedDayString(new Date(), tz);
  const dayList = Array.from({ length: 28 }, (_, i) =>
    new Date(Date.parse(`${today}T00:00:00Z`) - (27 - i) * DAY_MS).toISOString().slice(0, 10)
  );
  const { start } = zonedDayBounds(dayList[0], tz);

  const rows = await prisma.accountDailyStat.groupBy({
    by: ["date"],
    where: { date: { gte: start } },
    _sum: { viewsGained: true },
  });
  const byDay = new Map(rows.map((r) => [zonedDayString(r.date, tz), r._sum.viewsGained ?? 0]));
  const series = dayList.map((day) => ({ day, views: byDay.get(day) ?? 0 }));

  const values = series.map((s) => s.views);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const last7Avg = avg(values.slice(-7));
  const prev7Avg = avg(values.slice(-14, -7));
  const growthRate = prev7Avg > 0 ? last7Avg / prev7Avg - 1 : 0;

  // Projection model (kept deliberately simple): next-N totals = last-7-day
  // daily average × N × (1 + effectiveRate), where the effectiveRate is the
  // observed 7d-over-7d growth scaled per band — conservative ×0.7, current
  // ×1.0, optimistic ×1.3 — and floored at −100% so totals never go negative.
  const project = (days: number, band: number) =>
    Math.max(0, Math.round(last7Avg * days * (1 + Math.max(-1, growthRate * band))));

  return {
    days: series,
    last7Avg: Math.round(last7Avg),
    prev7Avg: Math.round(prev7Avg),
    growthRate,
    projections: {
      next7: {
        conservative: project(7, 0.7),
        current: project(7, 1.0),
        optimistic: project(7, 1.3),
      },
      next30: {
        conservative: project(30, 0.7),
        current: project(30, 1.0),
        optimistic: project(30, 1.3),
      },
    },
  };
}

export interface AccountDetail {
  account: {
    accountId: string;
    accountName: string;
    displayName: string;
    avatarUrl: string;
    driveFolderName: string | null;
    sectionName: string | null;
    color: string;
    connectionState: string;
  };
  days: { day: string; posts: number; views: number; likes: number }[];
  totals: { posts: number; views: number; likes: number };
  zeroViewStreak: number;
  lastPostAt: string | null;
  recentVideos: {
    id: string;
    url: string;
    views: number;
    likes: number;
    publishedAt: string;
    status: string;
  }[];
}

export async function getAccountDetail(
  userId: string,
  accountId: string,
  days = 30
): Promise<AccountDetail | null> {
  await assertAccess(userId);
  const tz = await getOrgTimezone();

  const account = await prisma.managedAccount.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      tiktokUsername: true,
      tiktokDisplayName: true,
      tiktokAvatarUrl: true,
      driveFolderName: true,
      color: true,
      connectionState: true,
      section: { select: { name: true } },
    },
  });
  if (!account) return null;

  const today = zonedDayString(new Date(), tz);
  const dayList = Array.from({ length: days }, (_, i) =>
    new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10)
  );
  const { start } = zonedDayBounds(dayList[0], tz);

  const [statRows, streaks, lastPosts, videos] = await Promise.all([
    prisma.accountDailyStat.findMany({
      where: { accountId, date: { gte: start } },
      select: { date: true, postsCount: true, viewsGained: true, likesGained: true },
    }),
    computeZeroViewStreaks([accountId]),
    computeLastPostAt([accountId]),
    prisma.trackedVideo.findMany({
      where: { accountId },
      orderBy: { publishedAt: "desc" },
      take: 15,
      select: { id: true, url: true, views: true, likes: true, publishedAt: true, status: true },
    }),
  ]);

  const byDay = new Map(statRows.map((r) => [zonedDayString(r.date, tz), r]));
  const series = dayList.map((day) => {
    const r = byDay.get(day);
    return {
      day,
      posts: r?.postsCount ?? 0,
      views: r?.viewsGained ?? 0,
      likes: r?.likesGained ?? 0,
    };
  });

  return {
    account: {
      accountId: account.id,
      accountName: account.tiktokUsername,
      displayName: account.tiktokDisplayName,
      avatarUrl: account.tiktokAvatarUrl,
      driveFolderName: account.driveFolderName,
      sectionName: account.section?.name ?? null,
      color: account.color,
      connectionState: account.connectionState,
    },
    days: series,
    totals: {
      posts: series.reduce((a, d) => a + d.posts, 0),
      views: series.reduce((a, d) => a + d.views, 0),
      likes: series.reduce((a, d) => a + d.likes, 0),
    },
    zeroViewStreak: streaks.get(accountId) ?? 0,
    lastPostAt: lastPosts.get(accountId)?.toISOString() ?? null,
    recentVideos: videos.map((v) => ({
      id: v.id,
      url: v.url,
      views: Number(v.views),
      likes: Number(v.likes),
      publishedAt: v.publishedAt.toISOString(),
      status: v.status,
    })),
  };
}
