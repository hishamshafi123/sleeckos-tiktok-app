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
// Quiet-account buckets, in whole IST days since the last published post:
// silent = 2–7 days, unused = 8+ days or never posted.
const SILENT_MIN_DAYS = 2;
const UNUSED_MIN_DAYS = 8;
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

// ── Active-account view-rate model ──────────────────────────────────────────
// "In-use" account: ≥1 published PostJob in the last 7 IST days. For each
// in-use account we estimate its current views/day from its recent video
// performance: take the last 3 captured TrackedVideos, age-normalize each
// (perDayViews = views ÷ max(1, whole days since publishedAt) — a 3-day-old
// video accumulated its views over 3 days, so raw views would inflate the
// daily rate), average those per-day rates, and multiply by the account's
// posting rate (published jobs in the last 7 days ÷ 7). The org baseline is
// the sum across in-use accounts. This complements AccountDailyStat deltas,
// which are thin before snapshots accumulate.

const VIEW_RATE_WINDOW_DAYS = 7;
const VIEW_RATE_SAMPLE_VIDEOS = 3;

export interface ActiveViewRate {
  accountId: string;
  postsPerDay: number;
  avgPerVideoPerDay: number; // mean age-normalized views/day across sampled videos
  estViewsPerDay: number;
  videosSampled: number;
}

async function computeActiveAccountViewRates(
  tz: string
): Promise<{ rates: Map<string, ActiveViewRate>; orgBaselinePerDay: number }> {
  const now = new Date();
  const today = zonedDayString(now, tz);
  const sinceDay = new Date(Date.parse(`${today}T00:00:00Z`) - (VIEW_RATE_WINDOW_DAYS - 1) * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const { start } = zonedDayBounds(sinceDay, tz);

  // Posting rate per account over the window.
  const jobRows = await prisma.postJob.groupBy({
    by: ["accountId"],
    where: { state: { in: TERMINAL_PUBLISHED_STATES }, publishedAt: { gte: start } },
    _count: { _all: true },
  });
  const activeIds = jobRows.map((r) => r.accountId);
  if (activeIds.length === 0) return { rates: new Map(), orgBaselinePerDay: 0 };

  // Recent captured videos for those accounts; last N per account in memory.
  const videos = await prisma.trackedVideo.findMany({
    where: { accountId: { in: activeIds }, status: "captured" },
    orderBy: { publishedAt: "desc" },
    select: { accountId: true, views: true, publishedAt: true },
  });
  const sampled = new Map<string, number[]>();
  for (const v of videos) {
    const arr = sampled.get(v.accountId);
    if (arr && arr.length >= VIEW_RATE_SAMPLE_VIDEOS) continue;
    // Age-normalize: views ÷ whole days live (<24h old counts as 1 day).
    const ageDays = Math.max(1, Math.floor((now.getTime() - v.publishedAt.getTime()) / DAY_MS));
    (arr ?? sampled.set(v.accountId, []).get(v.accountId)!).push(Number(v.views) / ageDays);
  }

  const rates = new Map<string, ActiveViewRate>();
  let orgBaselinePerDay = 0;
  for (const r of jobRows) {
    const postsPerDay = r._count._all / VIEW_RATE_WINDOW_DAYS;
    const perDayViews = sampled.get(r.accountId) ?? [];
    const avgPerVideoPerDay =
      perDayViews.length > 0
        ? Math.round(perDayViews.reduce((a, b) => a + b, 0) / perDayViews.length)
        : 0;
    const estViewsPerDay = Math.round(avgPerVideoPerDay * postsPerDay);
    orgBaselinePerDay += estViewsPerDay;
    rates.set(r.accountId, {
      accountId: r.accountId,
      postsPerDay: Math.round(postsPerDay * 100) / 100,
      avgPerVideoPerDay,
      estViewsPerDay,
      videosSampled: perDayViews.length,
    });
  }
  return { rates, orgBaselinePerDay };
}

export interface ActiveAccountViewRateRow extends ActiveViewRate {
  accountName: string;
  driveFolderName: string | null;
}

export async function getActiveAccountViewRates(
  userId: string
): Promise<{
  activeAccounts: number;
  orgBaselinePerDay: number;
  rows: ActiveAccountViewRateRow[];
}> {
  await assertAccess(userId);
  const tz = await getOrgTimezone();
  const { rates, orgBaselinePerDay } = await computeActiveAccountViewRates(tz);

  const accounts = await prisma.managedAccount.findMany({
    where: { id: { in: [...rates.keys()] } },
    select: { id: true, tiktokUsername: true, driveFolderName: true },
  });
  const rows: ActiveAccountViewRateRow[] = accounts.map((a) => ({
    ...rates.get(a.id)!,
    accountName: a.tiktokUsername,
    driveFolderName: a.driveFolderName,
  }));
  rows.sort((a, b) => b.estViewsPerDay - a.estViewsPerDay);

  return { activeAccounts: rows.length, orgBaselinePerDay, rows };
}

export interface AccountPerformanceRow {
  accountId: string;
  accountName: string;
  driveFolderName: string | null;
  driveFolderId: string | null; // linked Google Drive output folder (for external link)
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
  estViewsPerDay: number | null; // null when the account is not "in use" (no post in 7d)
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
      driveFolderId: true,
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
  const [stats, sparkRows, streaks, lastPosts, viewRates] = await Promise.all([
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
    computeActiveAccountViewRates(tz),
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
      driveFolderId: a.driveFolderId,
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
      estViewsPerDay: viewRates.rates.get(a.id)?.estViewsPerDay ?? null,
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
  silentAccounts: number; // last post 2–7 IST days ago
  unusedAccounts: number; // last post 8+ IST days ago, or never posted
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
    if (daysQuiet >= UNUSED_MIN_DAYS) unused++;
    else if (daysQuiet >= SILENT_MIN_DAYS) silent++;
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
  silent: QuietAccount[]; // daysQuiet 2–7
  unused: QuietAccount[]; // daysQuiet 8+, or null = never posted
}

interface QuietAccount {
  accountId: string;
  accountName: string;
  driveFolderName: string | null;
  driveFolderId: string | null;
  daysQuiet: number | null;
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
    select: { id: true, tiktokUsername: true, driveFolderName: true, driveFolderId: true },
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
    const base = {
      accountId: a.id,
      accountName: a.tiktokUsername,
      driveFolderName: a.driveFolderName,
      driveFolderId: a.driveFolderId,
    };
    const last = lastPosts.get(a.id);
    if (!last) {
      unused.push({ ...base, daysQuiet: null });
      continue;
    }
    const daysQuiet = Math.round(
      (todayStart.getTime() - zonedDayBounds(zonedDayString(last, tz), tz).start.getTime()) / DAY_MS
    );
    if (daysQuiet >= UNUSED_MIN_DAYS) {
      unused.push({ ...base, daysQuiet });
    } else if (daysQuiet >= SILENT_MIN_DAYS) {
      silent.push({ ...base, daysQuiet });
    }
  }
  silent.sort(
    (a, b) => (b.daysQuiet ?? 0) - (a.daysQuiet ?? 0) || a.accountName.localeCompare(b.accountName)
  );
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
  // Rate model (see computeActiveAccountViewRates): the projection "current"
  // rate is max(observed 7-day avg daily viewsGained, active-account baseline)
  // when the rollup has ≥7 days of data, otherwise the baseline alone.
  baselinePerDay: number; // sum of est views/day across in-use accounts
  activeAccounts: number; // in-use accounts the baseline is built from
  currentRatePerDay: number; // rate actually used for projections
  source: "observed" | "estimated"; // which side drove currentRatePerDay
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

  const [rows, viewRates] = await Promise.all([
    prisma.accountDailyStat.groupBy({
      by: ["date"],
      where: { date: { gte: start } },
      _sum: { viewsGained: true },
    }),
    computeActiveAccountViewRates(tz),
  ]);
  const byDay = new Map(rows.map((r) => [zonedDayString(r.date, tz), r._sum.viewsGained ?? 0]));
  const series = dayList.map((day) => ({ day, views: byDay.get(day) ?? 0 }));

  const values = series.map((s) => s.views);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const last7Avg = avg(values.slice(-7));
  const prev7Avg = avg(values.slice(-14, -7));
  const growthRate = prev7Avg > 0 ? last7Avg / prev7Avg - 1 : 0;

  // Projection model: daily rate × horizon, with fixed uncertainty bands
  // (conservative ×0.7, optimistic ×1.3). The daily rate is the active-account
  // baseline (recent per-video views × posting rate), blended with the
  // observed rollup once the rollup has ≥7 days of non-zero data — whichever
  // is larger wins, and `source` records which side drove it.
  const baseline = viewRates.orgBaselinePerDay;
  const daysWithData = values.filter((v) => v > 0).length;
  let currentRatePerDay: number;
  let source: Trajectory["source"];
  if (daysWithData >= 7 && last7Avg >= baseline) {
    currentRatePerDay = last7Avg;
    source = "observed";
  } else {
    currentRatePerDay = baseline;
    source = "estimated";
  }

  const project = (days: number, band: number) => Math.max(0, Math.round(currentRatePerDay * days * band));

  return {
    days: series,
    last7Avg: Math.round(last7Avg),
    prev7Avg: Math.round(prev7Avg),
    growthRate,
    baselinePerDay: baseline,
    activeAccounts: viewRates.rates.size,
    currentRatePerDay: Math.round(currentRatePerDay),
    source,
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
