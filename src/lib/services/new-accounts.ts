import { fromZonedTime } from "date-fns-tz";
import prisma from "@/lib/db";
import { getOrgTimezone, getZonedDateString } from "@/lib/services/timezone";

const PUBLISHED_STATES = ["PUBLISHED", "PENDING_DELETION", "DELETED"];
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// An account older than this with zero posts is treated as an onboarding
// failure, not "just new".
const NEVER_POSTED_GRACE_DAYS = 3;

export type NewAccountsQuery = {
  sectionId?: string;
  addedFrom?: string; // YYYY-MM-DD (org timezone)
  addedTo?: string; // YYYY-MM-DD (org timezone)
  search?: string;
  neverPosted?: boolean;
};

export type NewAccountRow = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  driveFolderId: string | null;
  driveFolderName: string | null;
  sectionId: string;
  sectionName: string;
  sectionSlug: string;
  color: string;
  colorMeaning: string | null;
  connectionState: string;
  hasPostPeer: boolean;
  addedAt: string; // ISO
  addedDate: string; // YYYY-MM-DD in org timezone
  ageDays: number;
  totalPosts: number;
  postsLast7d: number;
  firstPostAt: string | null; // ISO
  firstPostLatencyDays: number | null;
  labels: { id: string; name: string; color: string }[];
  warnings: ("no_drive" | "no_postpeer" | "never_posted")[];
  createdByName: string | null;
};

export type DailyCreatedPoint = { date: string; count: number };

export type CreatorStat = {
  userId: string;
  name: string;
  totalTracked: number; // all tracked adds (tracking began Sep 18, 2026)
  last7d: number;
  prev7d: number;
  last30d: number;
  avgPerDay7d: number;
  wowDelta: number; // last7d − prev7d
  daily: DailyCreatedPoint[]; // last 7 days, oldest → newest
};

export type AccountLifecycleSummary = {
  created7d: number;
  created30d: number;
  deleted7d: number;
  deleted30d: number;
  banned7d: number;
  banned30d: number;
};

export type NewAccountCohort = {
  weekStart: string; // YYYY-MM-DD, Monday in org timezone
  label: string; // "This week" | "Last week" | "Sep 7 – Sep 13"
  count: number;
  totalPosts: number;
  avgPostsPerAccount: number;
  avgFirstPostLatencyDays: number | null;
  neverPosted: number;
  accounts: NewAccountRow[];
};

export type NewAccountsResult = {
  timezone: string;
  generatedAt: string;
  totalAccounts: number;
  totalPosts: number;
  neverPostedCount: number;
  cohorts: NewAccountCohort[];
  /** Global (unfiltered) accounts-created-per-day for the last 30 days, org tz. */
  dailyCreated: DailyCreatedPoint[];
  /** Per-creator leaderboard (accounts added via Managed Accounts), 7d-ranked. */
  creators: CreatorStat[];
  lifecycle: AccountLifecycleSummary;
  projection: {
    avgPerDay7d: number;
    avgPerDay30d: number;
    createdLast7d: number;
    createdPrev7d: number;
    projectedNextWeek: number;
  };
};

/** Monday (YYYY-MM-DD) of the week containing the given YYYY-MM-DD, via UTC date math. */
function weekStartOf(dateStr: string): string {
  const d = new Date(Date.parse(`${dateStr}T00:00:00Z`));
  const dow = d.getUTCDay(); // 0 = Sunday
  const offset = (dow + 6) % 7; // days since Monday
  return new Date(d.getTime() - offset * DAY_MS).toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtShort(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${MONTH_SHORT[m - 1]} ${d}`;
}

function fmtShortWithYear(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${MONTH_SHORT[m - 1]} ${d}, ${y}`;
}

/**
 * New-accounts overview: accounts sorted newest → oldest by when they were
 * added to SleeckOS, grouped into weekly cohorts, with post counts aggregated
 * server-side over PostJob. Read-only reporting.
 */
export async function getNewAccountsOverview(query: NewAccountsQuery = {}): Promise<NewAccountsResult> {
  const { sectionId, addedFrom, addedTo, search, neverPosted } = query;
  if ((addedFrom && !DATE_RE.test(addedFrom)) || (addedTo && !DATE_RE.test(addedTo))) {
    throw new Error("addedFrom/addedTo must be YYYY-MM-DD");
  }
  if (addedFrom && addedTo && addedFrom > addedTo) {
    throw new Error("addedFrom must be on or before addedTo");
  }

  const tz = await getOrgTimezone();
  const now = new Date();

  const createdAt: { gte?: Date; lt?: Date } = {};
  if (addedFrom) createdAt.gte = fromZonedTime(`${addedFrom}T00:00:00`, tz);
  if (addedTo) createdAt.lt = fromZonedTime(`${addDays(addedTo, 1)}T00:00:00`, tz);

  const trimmedSearch = search?.trim();

  const accounts = await prisma.managedAccount.findMany({
    where: {
      ...(sectionId ? { sectionId } : {}),
      ...(addedFrom || addedTo ? { createdAt } : {}),
      ...(trimmedSearch
        ? {
            OR: [
              { tiktokUsername: { contains: trimmedSearch, mode: "insensitive" } },
              { tiktokDisplayName: { contains: trimmedSearch, mode: "insensitive" } },
              { driveFolderName: { contains: trimmedSearch, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      tiktokUsername: true,
      tiktokDisplayName: true,
      tiktokAvatarUrl: true,
      driveFolderId: true,
      driveFolderName: true,
      postpeerAccountId: true,
      color: true,
      connectionState: true,
      createdAt: true,
      section: { select: { id: true, name: true, slug: true } },
      colorRef: { select: { color: true, meaning: true } },
      labelAssignments: { select: { label: { select: { id: true, name: true, color: true } } } },
      createdBy: { select: { name: true, email: true } },
    },
  });

  const ids = accounts.map((a) => a.id);

  // Post counts: all-time (with first-post timestamp) + trailing 7 days.
  const [totals, last7d] = ids.length
    ? await Promise.all([
        prisma.postJob.groupBy({
          by: ["accountId"],
          where: { accountId: { in: ids }, state: { in: PUBLISHED_STATES } },
          _count: { _all: true },
          _min: { publishedAt: true },
        }),
        prisma.postJob.groupBy({
          by: ["accountId"],
          where: {
            accountId: { in: ids },
            state: { in: PUBLISHED_STATES },
            publishedAt: { gte: new Date(now.getTime() - 7 * DAY_MS) },
          },
          _count: { _all: true },
        }),
      ])
    : [[], []];

  const totalByAccount = new Map(totals.map((g) => [g.accountId, { count: g._count._all, first: g._min.publishedAt }]));
  const last7ByAccount = new Map(last7d.map((g) => [g.accountId, g._count._all]));

  let rows: NewAccountRow[] = accounts.map((a) => {
    const stats = totalByAccount.get(a.id);
    const totalPosts = stats?.count ?? 0;
    const firstPostAt = stats?.first ?? null;
    const ageDays = Math.max(0, Math.floor((now.getTime() - a.createdAt.getTime()) / DAY_MS));
    const firstPostLatencyDays = firstPostAt
      ? Math.max(0, Math.round((firstPostAt.getTime() - a.createdAt.getTime()) / DAY_MS))
      : null;

    const warnings: NewAccountRow["warnings"] = [];
    if (!a.driveFolderId) warnings.push("no_drive");
    if (!a.postpeerAccountId) warnings.push("no_postpeer");
    if (totalPosts === 0 && ageDays >= NEVER_POSTED_GRACE_DAYS) warnings.push("never_posted");

    return {
      id: a.id,
      username: a.tiktokUsername,
      displayName: a.tiktokDisplayName,
      avatarUrl: a.tiktokAvatarUrl,
      driveFolderId: a.driveFolderId,
      driveFolderName: a.driveFolderName,
      sectionId: a.section.id,
      sectionName: a.section.name,
      sectionSlug: a.section.slug,
      color: a.colorRef?.color ?? a.color,
      colorMeaning: a.colorRef?.meaning ?? null,
      connectionState: a.connectionState,
      hasPostPeer: Boolean(a.postpeerAccountId),
      addedAt: a.createdAt.toISOString(),
      addedDate: getZonedDateString(a.createdAt, tz),
      ageDays,
      totalPosts,
      postsLast7d: last7ByAccount.get(a.id) ?? 0,
      firstPostAt: firstPostAt ? firstPostAt.toISOString() : null,
      firstPostLatencyDays,
      labels: a.labelAssignments.map((la) => la.label),
      warnings,
      createdByName: a.createdBy?.name || a.createdBy?.email || null,
    };
  });

  if (neverPosted) {
    rows = rows.filter((r) => r.totalPosts === 0);
  }

  // ── Weekly cohorts (org-timezone weeks, Monday start), newest first ──────
  const thisWeek = weekStartOf(getZonedDateString(now, tz));
  const lastWeek = addDays(thisWeek, -7);

  const byCohort = new Map<string, NewAccountRow[]>();
  for (const row of rows) {
    const key = weekStartOf(row.addedDate);
    const list = byCohort.get(key);
    if (list) list.push(row);
    else byCohort.set(key, [row]);
  }

  const cohorts: NewAccountCohort[] = [...byCohort.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([weekStart, members]) => {
      const totalPosts = members.reduce((s, m) => s + m.totalPosts, 0);
      const latencies = members.map((m) => m.firstPostLatencyDays).filter((v): v is number => v !== null);
      const label =
        weekStart === thisWeek
          ? "This week"
          : weekStart === lastWeek
            ? "Last week"
            : `${fmtShort(weekStart)} – ${fmtShortWithYear(addDays(weekStart, 6))}`;
      return {
        weekStart,
        label,
        count: members.length,
        totalPosts,
        avgPostsPerAccount: members.length ? Math.round((totalPosts / members.length) * 10) / 10 : 0,
        avgFirstPostLatencyDays: latencies.length
          ? Math.round((latencies.reduce((s, v) => s + v, 0) / latencies.length) * 10) / 10
          : null,
        neverPosted: members.filter((m) => m.totalPosts === 0).length,
        accounts: members,
      };
    });

  // ── Creation rate / lifecycle / projection (global, unfiltered) ─────────
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);

  const [recentCreates, lifecycle30, lifecycle7] = await Promise.all([
    prisma.managedAccount.findMany({
      where: { createdAt: { gte: thirtyDaysAgo } },
      select: { createdAt: true, createdByUserId: true },
    }),
    prisma.accountLifecycleEvent.groupBy({
      by: ["type"],
      where: { createdAt: { gte: thirtyDaysAgo } },
      _count: { _all: true },
    }),
    prisma.accountLifecycleEvent.groupBy({
      by: ["type"],
      where: { createdAt: { gte: sevenDaysAgo } },
      _count: { _all: true },
    }),
  ]);

  // Daily buckets for the last 30 org-tz days (oldest → newest for the chart).
  const todayStr = getZonedDateString(now, tz);
  const createdBucket = new Map<string, number>();
  for (const a of recentCreates) {
    const d = getZonedDateString(a.createdAt, tz);
    createdBucket.set(d, (createdBucket.get(d) || 0) + 1);
  }
  const dailyCreated: DailyCreatedPoint[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = addDays(todayStr, -i);
    dailyCreated.push({ date: d, count: createdBucket.get(d) || 0 });
  }

  const countType = (groups: { type: string; _count: { _all: number } }[], t: string) =>
    groups.find((g) => g.type === t)?._count._all ?? 0;

  const lifecycle: AccountLifecycleSummary = {
    created7d: countType(lifecycle7, "created"),
    created30d: countType(lifecycle30, "created"),
    deleted7d: countType(lifecycle7, "deleted"),
    deleted30d: countType(lifecycle30, "deleted"),
    banned7d: countType(lifecycle7, "marked_banned"),
    banned30d: countType(lifecycle30, "marked_banned"),
  };

  const createdLast7d = dailyCreated.slice(-7).reduce((s, p) => s + p.count, 0);
  const createdPrev7d = dailyCreated.slice(-14, -7).reduce((s, p) => s + p.count, 0);
  const created30dTotal = dailyCreated.reduce((s, p) => s + p.count, 0);
  const avgPerDay7d = Math.round((createdLast7d / 7) * 10) / 10;
  const avgPerDay30d = Math.round((created30dTotal / 30) * 10) / 10;

  const projection = {
    avgPerDay7d,
    avgPerDay30d,
    createdLast7d,
    createdPrev7d,
    projectedNextWeek: Math.round(avgPerDay7d * 7),
  };

  // ── Per-creator leaderboard (tracked adds only) ──────────────────────────
  const last7Dates = new Set(dailyCreated.slice(-7).map((p) => p.date));
  const prev7Dates = new Set(dailyCreated.slice(-14, -7).map((p) => p.date));
  const byCreator = new Map<string, Map<string, number>>(); // userId → date → count
  const creatorTotals = new Map<string, number>();
  for (const a of recentCreates) {
    if (!a.createdByUserId) continue;
    const d = getZonedDateString(a.createdAt, tz);
    const m = byCreator.get(a.createdByUserId) || new Map<string, number>();
    m.set(d, (m.get(d) || 0) + 1);
    byCreator.set(a.createdByUserId, m);
    creatorTotals.set(a.createdByUserId, (creatorTotals.get(a.createdByUserId) || 0) + 1);
  }

  const creatorUsers = byCreator.size
    ? await prisma.user.findMany({
        where: { id: { in: [...byCreator.keys()] } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const nameById = new Map(creatorUsers.map((u) => [u.id, u.name || u.email]));

  const creators: CreatorStat[] = [...byCreator.entries()]
    .map(([userId, days]) => {
      const last7d = [...days.entries()].filter(([d]) => last7Dates.has(d)).reduce((s, [, c]) => s + c, 0);
      const prev7d = [...days.entries()].filter(([d]) => prev7Dates.has(d)).reduce((s, [, c]) => s + c, 0);
      return {
        userId,
        name: nameById.get(userId) || "Unknown user",
        totalTracked: creatorTotals.get(userId) || 0,
        last7d,
        prev7d,
        last30d: [...days.values()].reduce((s, c) => s + c, 0),
        avgPerDay7d: Math.round((last7d / 7) * 10) / 10,
        wowDelta: last7d - prev7d,
        daily: dailyCreated.slice(-7).map((p) => ({ date: p.date, count: days.get(p.date) || 0 })),
      };
    })
    .sort((a, b) => b.last7d - a.last7d || b.totalTracked - a.totalTracked);

  return {
    timezone: tz,
    generatedAt: now.toISOString(),
    totalAccounts: rows.length,
    totalPosts: rows.reduce((s, r) => s + r.totalPosts, 0),
    neverPostedCount: rows.filter((r) => r.totalPosts === 0).length,
    cohorts,
    dailyCreated,
    creators,
    lifecycle,
    projection,
  };
}
