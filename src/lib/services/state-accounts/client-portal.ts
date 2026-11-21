import crypto from "crypto";
import prisma from "@/lib/db";
import { fromZonedTime } from "date-fns-tz";
import { STATES } from "../content-desk/rules";
import { STATE_WHERE, normalizeStateName } from "./registry";
import { generateShareCode } from "@/lib/services/track-share";

// ─── Rate limiting (public portal & public REST API) ──────────────────────────
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;

const globalForStateRateLimit = globalThis as unknown as {
  statePublicRateLimit?: Map<string, { count: number; resetAt: number }>;
};

export function checkStatePublicRateLimit(ip: string): boolean {
  const map = (globalForStateRateLimit.statePublicRateLimit ??= new Map());
  const now = Date.now();
  if (map.size > 5000) {
    for (const [key, entry] of map) {
      if (entry.resetAt < now) map.delete(key);
    }
  }
  const entry = map.get(ip);
  if (!entry || entry.resetAt < now) {
    map.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= RATE_LIMIT_MAX;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const KEY_PREFIX = "slk_";
const LAST_USED_THROTTLE_MS = 60_000;

function hashKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

export function slugifyState(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "state";
}

export function resolveStateCode(name: string): string | null {
  const norm = normalizeStateName(name);
  const found = STATES.find(
    (s) =>
      normalizeStateName(s.name) === norm ||
      s.code.toLowerCase() === norm,
  );
  return found ? found.code : null;
}

function safeNum(v: bigint | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return Number(v);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function engagementPct(likes: number, views: number): number {
  return views > 0 ? round2((likes / views) * 100) : 0;
}

// ─── Access Types & Validation ────────────────────────────────────────────────

export type StateAccessScope = {
  source: "share" | "api_client";
  id: string;
  title: string;
  allStates: boolean;
  stateNames: string[];
};

export async function findValidStateShare(code: string) {
  const normalized = code.trim().toUpperCase();
  if (!normalized || normalized.length > 64) return null;
  const share = await prisma.stateAccountShare.findUnique({
    where: { code: normalized },
  });
  if (!share) return null;
  if (share.revokedAt) return null;
  if (share.expiresAt && share.expiresAt.getTime() < Date.now()) return null;
  return share;
}

/**
 * Validate a credential for the State Accounts Public API (`x-api-key`).
 * Accepts either:
 *  - a Client API key (`slk_...`) whose ApiClient has `stateAccess` granted, or
 *  - a State Account share code (`StateAccountShare.code`).
 */
export async function validateStateApiAccess(
  rawKey: string,
): Promise<StateAccessScope | null> {
  const trimmed = rawKey.trim();
  if (!trimmed || trimmed.length > 128) return null;

  if (trimmed.startsWith(KEY_PREFIX)) {
    const key = await prisma.apiClientKey.findUnique({
      where: { keyHash: hashKey(trimmed) },
      select: {
        id: true,
        revokedAt: true,
        lastUsedAt: true,
        client: {
          select: {
            id: true,
            name: true,
            revokedAt: true,
            stateAccess: true,
          },
        },
      },
    });
    if (!key || key.revokedAt || key.client.revokedAt) return null;
    const access = key.client.stateAccess;
    if (!access) return null;
    if (!access.allStates && access.stateNames.length === 0) return null;

    if (
      !key.lastUsedAt ||
      Date.now() - key.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS
    ) {
      prisma.apiClientKey
        .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
        .catch(() => {});
    }

    return {
      source: "api_client",
      id: key.client.id,
      title: key.client.name,
      allStates: access.allStates,
      stateNames: access.stateNames,
    };
  }

  const share = await findValidStateShare(trimmed);
  if (!share) return null;
  if (!share.allStates && share.stateNames.length === 0) return null;

  return {
    source: "share",
    id: share.id,
    title: share.title,
    allStates: share.allStates,
    stateNames: share.stateNames,
  };
}

// ─── Admin Share Management ───────────────────────────────────────────────────

export async function listStateAccountShares() {
  const shares = await prisma.stateAccountShare.findMany({
    orderBy: { createdAt: "desc" },
  });
  return shares.map((s) => ({
    id: s.id,
    code: s.code,
    title: s.title,
    label: s.label,
    allStates: s.allStates,
    stateNames: s.stateNames,
    createdBy: s.createdBy,
    createdAt: s.createdAt.toISOString(),
    expiresAt: s.expiresAt ? s.expiresAt.toISOString() : null,
    revokedAt: s.revokedAt ? s.revokedAt.toISOString() : null,
  }));
}

export async function createStateAccountShare(input: {
  title: string;
  label?: string;
  allStates: boolean;
  stateNames?: string[];
  expiresInDays?: number | null;
  createdBy?: string;
}) {
  const title = input.title.trim().slice(0, 120);
  if (!title) throw new Error("Report title is required.");

  const allStates = Boolean(input.allStates);
  const stateNames = allStates
    ? []
    : [...new Set((input.stateNames || []).map((s) => s.trim()).filter(Boolean))];
  if (!allStates && stateNames.length === 0) {
    throw new Error("Select at least one state account or grant all states.");
  }

  let expiresAt: Date | null = null;
  if (input.expiresInDays && input.expiresInDays > 0) {
    expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);
  }

  // Generate unique code with retry
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateShareCode(10);
    try {
      const created = await prisma.stateAccountShare.create({
        data: {
          code,
          title,
          label: input.label?.trim().slice(0, 120) || null,
          allStates,
          stateNames,
          createdBy: input.createdBy || null,
          expiresAt,
        },
      });
      return {
        id: created.id,
        code: created.code,
        title: created.title,
        label: created.label,
        allStates: created.allStates,
        stateNames: created.stateNames,
        createdAt: created.createdAt.toISOString(),
        expiresAt: created.expiresAt ? created.expiresAt.toISOString() : null,
        revokedAt: null,
      };
    } catch (err: unknown) {
      if ((err as { code?: string }).code === "P2002") continue;
      throw err;
    }
  }
  throw new Error("Failed to generate a unique share code.");
}

export async function revokeStateAccountShare(id: string) {
  await prisma.stateAccountShare.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
}

// ─── Core Client Data Loader ──────────────────────────────────────────────────

export type ClientStateDailyPoint = {
  date: string;
  viewsGained: number;
  likesGained: number;
  followerGrowth: number;
  posts: number;
  metricsObserved: boolean;
  followersObserved: boolean;
};

export type ClientStateAccountSummary = {
  id: string;
  slug: string;
  stateName: string;
  stateCode: string | null;
  username: string;
  displayName: string;
  profileUrl: string;
  followers: number | null;
  profileLikes: number | null;
  trackedVideos: number;
  totalVideoViews: number;
  totalVideoLikes: number;
  avgViewsPerVideo: number;
  engagementRate: number;
  periodViewsGained: number;
  periodLikesGained: number;
  periodFollowerGrowth: number;
  periodPosts: number;
  todayViewsGained: number;
  todayLikesGained: number;
  todayPosts: number;
  weekOverWeekViewsPct: number | null;
  lastSyncAt: string | null;
};

export type ClientStateVideo = {
  videoId: string;
  accountId: string;
  stateName: string;
  stateCode: string | null;
  stateSlug: string;
  username: string;
  url: string;
  publishedAt: string;
  views: number;
  likes: number;
  engagementRate: number;
  lastObservedAt: string;
};

export type ClientPortalAccount = ClientStateAccountSummary & {
  daily: ClientStateDailyPoint[];
};

export type ClientPortalPayload = {
  scope: {
    title: string;
    allStates: boolean;
    stateNames: string[];
  };
  timezone: string;
  dataUpdatedAt: string | null;
  refreshCadence: "hourly";
  days: {
    date: string;
    startsAt: string;
    endsAt: string;
    isCurrentDay: boolean;
  }[];
  accounts: ClientPortalAccount[];
  videos: ClientStateVideo[];
};

type ResolvedAccountMeta = {
  id: string;
  slug: string;
  stateName: string;
  stateCode: string | null;
  username: string;
  displayName: string;
  profileUrl: string;
  followers: number | null;
  profileLikes: number | null;
  lastSyncAt: Date | null;
  lineageIds: string[];
};

function matchesScope(meta: ResolvedAccountMeta, scope: StateAccessScope): boolean {
  if (scope.allStates) return true;
  const targets = new Set(scope.stateNames.map((n) => normalizeStateName(n)));
  const targetSlugs = new Set(scope.stateNames.map((n) => slugifyState(n)));
  const rawSet = new Set(scope.stateNames.map((n) => n.trim().toLowerCase()));
  return (
    targets.has(normalizeStateName(meta.stateName)) ||
    targetSlugs.has(meta.slug) ||
    rawSet.has(meta.id.toLowerCase()) ||
    (meta.stateCode !== null && rawSet.has(meta.stateCode.toLowerCase()))
  );
}

function matchesIdentifier(meta: ResolvedAccountMeta, identifier: string): boolean {
  const clean = identifier.trim();
  if (!clean) return false;
  const lower = clean.toLowerCase();
  return (
    meta.id.toLowerCase() === lower ||
    meta.slug === lower ||
    (meta.stateCode !== null && meta.stateCode.toLowerCase() === lower) ||
    normalizeStateName(meta.stateName) === normalizeStateName(clean)
  );
}

function computeWoW(
  daily: ClientStateDailyPoint[],
  dayMeta: { date: string; isCurrentDay: boolean }[],
): number | null {
  const currentDates = new Set(
    dayMeta.filter((d) => d.isCurrentDay).map((d) => d.date),
  );
  const completed = daily.filter(
    (d) => !currentDates.has(d.date) && d.metricsObserved,
  );
  if (completed.length < 6) return null;
  const recent = completed.slice(-7);
  const prior = completed.slice(-14, -7);
  if (recent.length < 3 || prior.length < 3) return null;
  const recentAvg =
    recent.reduce((sum, d) => sum + d.viewsGained, 0) / recent.length;
  const priorAvg =
    prior.reduce((sum, d) => sum + d.viewsGained, 0) / prior.length;
  if (priorAvg <= 0) return null;
  return round1((recentAvg / priorAvg - 1) * 100);
}

async function loadAuthorizedAccounts(
  scope: StateAccessScope,
): Promise<ResolvedAccountMeta[]> {
  const [activeRows, retiredRows] = await Promise.all([
    prisma.stateAccount.findMany({
      where: { account: STATE_WHERE },
      include: {
        guardianPhone: { select: { name: true } },
        account: {
          select: {
            tiktokUsername: true,
            tiktokDisplayName: true,
            driveFolderName: true,
            isActive: true,
          },
        },
      },
    }),
    prisma.stateAccount.findMany({
      where: { replacedByAccountId: { not: null } },
      select: {
        accountId: true,
        replacementOfAccountId: true,
      },
    }),
  ]);

  const predecessorById = new Map<string, string | null>();
  for (const r of retiredRows) {
    predecessorById.set(r.accountId, r.replacementOfAccountId);
  }

  const resolved: ResolvedAccountMeta[] = activeRows.map((a) => {
    const rawUsername = (
      a.account?.tiktokUsername ||
      a.usernameSnapshot ||
      ""
    ).replace(/^@/, "");
    const stateName =
      a.stateName ||
      a.guardianPhone?.name ||
      a.account?.driveFolderName ||
      a.account?.tiktokDisplayName ||
      rawUsername ||
      a.accountId;

    // Collect active + replacement predecessor lineage without cycles
    const lineage = new Set<string>([a.accountId]);
    let cursor = a.replacementOfAccountId;
    while (cursor && !lineage.has(cursor)) {
      lineage.add(cursor);
      cursor = predecessorById.get(cursor) ?? null;
    }

    return {
      id: a.accountId,
      slug: slugifyState(stateName),
      stateName,
      stateCode: resolveStateCode(stateName),
      username: rawUsername,
      displayName: a.account?.tiktokDisplayName || stateName,
      profileUrl: rawUsername
        ? `https://www.tiktok.com/@${encodeURIComponent(rawUsername)}`
        : "",
      followers: a.followers !== null ? safeNum(a.followers) : null,
      profileLikes: a.profileLikes !== null ? safeNum(a.profileLikes) : null,
      lastSyncAt: a.lastSyncAt,
      lineageIds: [...lineage],
    };
  });

  // Sort alphabetically by stateName for predictable presentation
  return resolved
    .filter((m) => matchesScope(m, scope))
    .sort((a, b) => a.stateName.localeCompare(b.stateName));
}

async function buildDataset(
  scope: StateAccessScope,
  opts?: { maxDays?: number; from?: string; to?: string; videoLimit?: number },
) {
  const accounts = await loadAuthorizedAccounts(scope);
  const allLineageIds = [...new Set(accounts.flatMap((a) => a.lineageIds))];
  const ownerByLineageId = new Map<string, ResolvedAccountMeta>();
  for (const acc of accounts) {
    for (const lid of acc.lineageIds) ownerByLineageId.set(lid, acc);
  }

  const maxDays = opts?.maxDays ?? 90;
  const now = new Date();

  const [daysRaw, videosRaw, tzSetting] = await Promise.all([
    prisma.stateReportingDay.findMany({
      where:
        opts?.from || opts?.to
          ? {
              label: {
                ...(opts.from ? { gte: opts.from } : {}),
                ...(opts.to ? { lte: opts.to } : {}),
              },
            }
          : undefined,
      orderBy: { startsAt: "desc" },
      take: opts?.from || opts?.to ? 365 : maxDays,
      include: {
        accounts: allLineageIds.length
          ? {
              where: { accountId: { in: allLineageIds } },
              select: {
                accountId: true,
                views: true,
                likes: true,
                followerGrowth: true,
                posts: true,
                metricsObserved: true,
                followersObserved: true,
              },
            }
          : false,
      },
    }),
    allLineageIds.length
      ? prisma.stateVideo.findMany({
          where: {
            accountId: { in: allLineageIds },
            unavailable: false,
          },
          orderBy: [{ views: "desc" }, { publishedAt: "desc" }],
          take: opts?.videoLimit ?? 2500,
          select: {
            videoId: true,
            accountId: true,
            url: true,
            publishedAt: true,
            views: true,
            likes: true,
            lastObservedAt: true,
          },
        })
      : Promise.resolve([]),
    prisma.appSetting.findUnique({ where: { key: "state_accounts_timezone" } }),
  ]);

  // Reverse to chronological ascending
  const days = [...daysRaw].reverse();
  const timezone =
    days[days.length - 1]?.timezone || tzSetting?.value || "Asia/Kolkata";

  const dayMeta = days.map((d) => ({
    date: d.label,
    startsAt: d.startsAt.toISOString(),
    endsAt: d.endsAt.toISOString(),
    isCurrentDay: d.endsAt.getTime() > now.getTime(),
  }));

  // Group videos by active account
  const videosByAccount = new Map<string, ClientStateVideo[]>();
  for (const acc of accounts) videosByAccount.set(acc.id, []);

  const allVideos: ClientStateVideo[] = [];
  for (const v of videosRaw) {
    const owner = ownerByLineageId.get(v.accountId);
    if (!owner) continue;
    const views = safeNum(v.views);
    const likes = safeNum(v.likes);
    const item: ClientStateVideo = {
      videoId: v.videoId,
      accountId: owner.id,
      stateName: owner.stateName,
      stateCode: owner.stateCode,
      stateSlug: owner.slug,
      username: owner.username,
      url: v.url,
      publishedAt: v.publishedAt.toISOString(),
      views,
      likes,
      engagementRate: engagementPct(likes, views),
      lastObservedAt: v.lastObservedAt.toISOString(),
    };
    videosByAccount.get(owner.id)!.push(item);
    allVideos.push(item);
  }

  // Build per-account daily series & totals
  let dataUpdatedAt: Date | null = null;
  for (const acc of accounts) {
    if (acc.lastSyncAt && (!dataUpdatedAt || acc.lastSyncAt > dataUpdatedAt)) {
      dataUpdatedAt = acc.lastSyncAt;
    }
  }
  for (const v of videosRaw) {
    if (!dataUpdatedAt || v.lastObservedAt > dataUpdatedAt) {
      dataUpdatedAt = v.lastObservedAt;
    }
  }

  const latestDay = days[days.length - 1] ?? null;

  const portalAccounts: ClientPortalAccount[] = accounts.map((acc) => {
    const lineageSet = new Set(acc.lineageIds);
    const daily: ClientStateDailyPoint[] = days.map((d) => {
      const rows = Array.isArray(d.accounts)
        ? d.accounts.filter((r) => lineageSet.has(r.accountId))
        : [];
      return {
        date: d.label,
        viewsGained: rows.reduce((s, r) => s + safeNum(r.views), 0),
        likesGained: rows.reduce((s, r) => s + safeNum(r.likes), 0),
        followerGrowth: rows.reduce((s, r) => s + safeNum(r.followerGrowth), 0),
        posts: rows.reduce((s, r) => s + r.posts, 0),
        metricsObserved: rows.some((r) => r.metricsObserved),
        followersObserved: rows.some((r) => r.followersObserved),
      };
    });

    const accVideos = videosByAccount.get(acc.id) || [];
    const totalVideoViews = accVideos.reduce((s, v) => s + v.views, 0);
    const totalVideoLikes = accVideos.reduce((s, v) => s + v.likes, 0);
    const periodViewsGained = daily.reduce((s, d) => s + d.viewsGained, 0);
    const periodLikesGained = daily.reduce((s, d) => s + d.likesGained, 0);
    const periodFollowerGrowth = daily.reduce((s, d) => s + d.followerGrowth, 0);
    const periodPosts = daily.reduce((s, d) => s + d.posts, 0);
    const todayPoint = latestDay ? daily[daily.length - 1] : null;

    return {
      id: acc.id,
      slug: acc.slug,
      stateName: acc.stateName,
      stateCode: acc.stateCode,
      username: acc.username,
      displayName: acc.displayName,
      profileUrl: acc.profileUrl,
      followers: acc.followers,
      profileLikes: acc.profileLikes,
      trackedVideos: accVideos.length,
      totalVideoViews,
      totalVideoLikes,
      avgViewsPerVideo:
        accVideos.length > 0 ? Math.round(totalVideoViews / accVideos.length) : 0,
      engagementRate: engagementPct(totalVideoLikes, totalVideoViews),
      periodViewsGained,
      periodLikesGained,
      periodFollowerGrowth,
      periodPosts,
      todayViewsGained: todayPoint?.viewsGained ?? 0,
      todayLikesGained: todayPoint?.likesGained ?? 0,
      todayPosts: todayPoint?.posts ?? 0,
      weekOverWeekViewsPct: computeWoW(daily, dayMeta),
      lastSyncAt: acc.lastSyncAt ? acc.lastSyncAt.toISOString() : null,
      daily,
    };
  });

  return {
    timezone,
    dataUpdatedAt: dataUpdatedAt ? dataUpdatedAt.toISOString() : null,
    dayMeta,
    accounts: portalAccounts,
    videos: allVideos,
    metas: accounts,
  };
}

// ─── 1. Client Portal Dashboard Payload ───────────────────────────────────────

export async function getClientPortalPayload(
  scope: StateAccessScope,
): Promise<ClientPortalPayload> {
  const dataset = await buildDataset(scope, { maxDays: 90, videoLimit: 2500 });
  return {
    scope: {
      title: scope.title,
      allStates: scope.allStates,
      stateNames: scope.stateNames,
    },
    timezone: dataset.timezone,
    dataUpdatedAt: dataset.dataUpdatedAt,
    refreshCadence: "hourly",
    days: dataset.dayMeta,
    accounts: dataset.accounts,
    videos: dataset.videos,
  };
}

// ─── 2. Public API: GET /api/public/v1/state-accounts ─────────────────────────

export async function getPublicStateAccountsSummary(
  scope: StateAccessScope,
  opts?: { days?: number; from?: string; to?: string },
) {
  const daysWindow = opts?.days ?? 30;
  const dataset = await buildDataset(scope, {
    maxDays: daysWindow,
    from: opts?.from,
    to: opts?.to,
    videoLimit: 5000,
  });

  // Aggregate daily series across all authorized accounts
  const aggDaily: ClientStateDailyPoint[] = dataset.dayMeta.map((dm, idx) => {
    let viewsGained = 0;
    let likesGained = 0;
    let followerGrowth = 0;
    let posts = 0;
    let metricsObserved = false;
    let followersObserved = false;
    for (const acc of dataset.accounts) {
      const pt = acc.daily[idx];
      if (!pt) continue;
      viewsGained += pt.viewsGained;
      likesGained += pt.likesGained;
      followerGrowth += pt.followerGrowth;
      posts += pt.posts;
      metricsObserved ||= pt.metricsObserved;
      followersObserved ||= pt.followersObserved;
    }
    return {
      date: dm.date,
      viewsGained,
      likesGained,
      followerGrowth,
      posts,
      metricsObserved,
      followersObserved,
    };
  });

  const totalFollowers = dataset.accounts.reduce(
    (s, a) => s + (a.followers ?? 0),
    0,
  );
  const totalProfileLikes = dataset.accounts.reduce(
    (s, a) => s + (a.profileLikes ?? 0),
    0,
  );
  const trackedVideos = dataset.accounts.reduce(
    (s, a) => s + a.trackedVideos,
    0,
  );
  const totalVideoViews = dataset.accounts.reduce(
    (s, a) => s + a.totalVideoViews,
    0,
  );
  const totalVideoLikes = dataset.accounts.reduce(
    (s, a) => s + a.totalVideoLikes,
    0,
  );
  const periodViewsGained = aggDaily.reduce((s, d) => s + d.viewsGained, 0);
  const periodLikesGained = aggDaily.reduce((s, d) => s + d.likesGained, 0);
  const periodFollowerGrowth = aggDaily.reduce(
    (s, d) => s + d.followerGrowth,
    0,
  );
  const periodPosts = aggDaily.reduce((s, d) => s + d.posts, 0);
  const todayPoint = aggDaily[aggDaily.length - 1] ?? null;

  return {
    scope: {
      title: scope.title,
      allStates: scope.allStates,
      accountCount: dataset.accounts.length,
    },
    timezone: dataset.timezone,
    dataUpdatedAt: dataset.dataUpdatedAt,
    refreshCadence: "hourly" as const,
    range: {
      days: dataset.dayMeta.length,
      from: dataset.dayMeta[0]?.date ?? opts?.from ?? null,
      to:
        dataset.dayMeta[dataset.dayMeta.length - 1]?.date ?? opts?.to ?? null,
    },
    totals: {
      activeAccounts: dataset.accounts.length,
      followers: totalFollowers,
      profileLikes: totalProfileLikes,
      trackedVideos,
      totalVideoViews,
      totalVideoLikes,
      avgViewsPerVideo:
        trackedVideos > 0 ? Math.round(totalVideoViews / trackedVideos) : 0,
      engagementRate: engagementPct(totalVideoLikes, totalVideoViews),
      periodViewsGained,
      periodLikesGained,
      periodFollowerGrowth,
      periodPosts,
      todayViewsGained: todayPoint?.viewsGained ?? 0,
      todayLikesGained: todayPoint?.likesGained ?? 0,
      todayPosts: todayPoint?.posts ?? 0,
      weekOverWeekViewsPct: computeWoW(aggDaily, dataset.dayMeta),
    },
    daily: aggDaily,
    accounts: dataset.accounts.map((acc) => {
      const summary: ClientStateAccountSummary = {
        id: acc.id,
        slug: acc.slug,
        stateName: acc.stateName,
        stateCode: acc.stateCode,
        username: acc.username,
        displayName: acc.displayName,
        profileUrl: acc.profileUrl,
        followers: acc.followers,
        profileLikes: acc.profileLikes,
        trackedVideos: acc.trackedVideos,
        totalVideoViews: acc.totalVideoViews,
        totalVideoLikes: acc.totalVideoLikes,
        avgViewsPerVideo: acc.avgViewsPerVideo,
        engagementRate: acc.engagementRate,
        periodViewsGained: acc.periodViewsGained,
        periodLikesGained: acc.periodLikesGained,
        periodFollowerGrowth: acc.periodFollowerGrowth,
        periodPosts: acc.periodPosts,
        todayViewsGained: acc.todayViewsGained,
        todayLikesGained: acc.todayLikesGained,
        todayPosts: acc.todayPosts,
        weekOverWeekViewsPct: acc.weekOverWeekViewsPct,
        lastSyncAt: acc.lastSyncAt,
      };
      return summary;
    }),
  };
}

// ─── 3. Public API: GET /api/public/v1/state-accounts/[stateOrId] ─────────────

export async function getPublicStateAccountDetail(
  scope: StateAccessScope,
  stateOrId: string,
  opts?: { days?: number; from?: string; to?: string },
) {
  const daysWindow = opts?.days ?? 30;
  const dataset = await buildDataset(scope, {
    maxDays: daysWindow,
    from: opts?.from,
    to: opts?.to,
    videoLimit: 5000,
  });

  const idx = dataset.metas.findIndex((m) => matchesIdentifier(m, stateOrId));
  if (idx === -1) return null;

  const account = dataset.accounts[idx];
  const { daily, ...summary } = account;
  const accVideos = dataset.videos.filter((v) => v.accountId === account.id);
  const topVideos = [...accVideos]
    .sort((a, b) => b.views - a.views)
    .slice(0, 10);
  const recentVideos = [...accVideos]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 20);

  return {
    scope: {
      title: scope.title,
      allStates: scope.allStates,
    },
    timezone: dataset.timezone,
    dataUpdatedAt: dataset.dataUpdatedAt,
    refreshCadence: "hourly" as const,
    range: {
      days: dataset.dayMeta.length,
      from: dataset.dayMeta[0]?.date ?? opts?.from ?? null,
      to:
        dataset.dayMeta[dataset.dayMeta.length - 1]?.date ?? opts?.to ?? null,
    },
    account: summary,
    daily,
    topVideos,
    recentVideos,
  };
}

// ─── 4. Public API: GET /api/public/v1/state-accounts/posts ───────────────────

export async function getPublicStateAccountPosts(
  scope: StateAccessScope,
  opts?: {
    state?: string;
    from?: string;
    to?: string;
    sort?: "publishedAt" | "views" | "likes";
    limit?: number;
    offset?: number;
  },
) {
  const accounts = await loadAuthorizedAccounts(scope);
  let targetAccounts = accounts;
  let matchedState: ResolvedAccountMeta | null = null;

  if (opts?.state) {
    matchedState =
      accounts.find((m) => matchesIdentifier(m, opts.state!)) ?? null;
    if (!matchedState) return null; // Not found or not authorized
    targetAccounts = [matchedState];
  }

  const lineageIds = [...new Set(targetAccounts.flatMap((a) => a.lineageIds))];
  const ownerByLineageId = new Map<string, ResolvedAccountMeta>();
  for (const acc of targetAccounts) {
    for (const lid of acc.lineageIds) ownerByLineageId.set(lid, acc);
  }

  const [latestDay, tzSetting] = await Promise.all([
    prisma.stateReportingDay.findFirst({
      orderBy: { startsAt: "desc" },
      select: { timezone: true },
    }),
    prisma.appSetting.findUnique({ where: { key: "state_accounts_timezone" } }),
  ]);
  const timezone = latestDay?.timezone || tzSetting?.value || "Asia/Kolkata";

  let publishedAtFilter: { gte?: Date; lt?: Date } | undefined;
  if (opts?.from || opts?.to) {
    publishedAtFilter = {};
    if (opts.from) {
      publishedAtFilter.gte = fromZonedTime(`${opts.from}T00:00:00`, timezone);
    }
    if (opts.to) {
      // Inclusive end date in reporting timezone: next day at 00:00:00
      const endDate = new Date(`${opts.to}T12:00:00Z`);
      endDate.setUTCDate(endDate.getUTCDate() + 1);
      const nextDayStr = endDate.toISOString().slice(0, 10);
      publishedAtFilter.lt = fromZonedTime(`${nextDayStr}T00:00:00`, timezone);
    }
  }

  const where = {
    accountId: { in: lineageIds },
    unavailable: false,
    ...(publishedAtFilter ? { publishedAt: publishedAtFilter } : {}),
  };

  const sort = opts?.sort || "publishedAt";
  const orderBy =
    sort === "views"
      ? [{ views: "desc" as const }, { publishedAt: "desc" as const }]
      : sort === "likes"
        ? [{ likes: "desc" as const }, { publishedAt: "desc" as const }]
        : [{ publishedAt: "desc" as const }, { videoId: "asc" as const }];

  const limit = Math.max(1, Math.min(500, opts?.limit ?? 100));
  const offset = Math.max(0, opts?.offset ?? 0);

  const [rows, total] = lineageIds.length
    ? await Promise.all([
        prisma.stateVideo.findMany({
          where,
          orderBy,
          take: limit,
          skip: offset,
          select: {
            videoId: true,
            accountId: true,
            url: true,
            publishedAt: true,
            views: true,
            likes: true,
            lastObservedAt: true,
          },
        }),
        prisma.stateVideo.count({ where }),
      ])
    : [[], 0];

  let dataUpdatedAt: Date | null = null;
  for (const acc of targetAccounts) {
    if (acc.lastSyncAt && (!dataUpdatedAt || acc.lastSyncAt > dataUpdatedAt)) {
      dataUpdatedAt = acc.lastSyncAt;
    }
  }
  for (const r of rows) {
    if (!dataUpdatedAt || r.lastObservedAt > dataUpdatedAt) {
      dataUpdatedAt = r.lastObservedAt;
    }
  }

  const posts: ClientStateVideo[] = rows
    .map((r) => {
      const owner = ownerByLineageId.get(r.accountId);
      if (!owner) return null;
      const views = safeNum(r.views);
      const likes = safeNum(r.likes);
      return {
        videoId: r.videoId,
        accountId: owner.id,
        stateName: owner.stateName,
        stateCode: owner.stateCode,
        stateSlug: owner.slug,
        username: owner.username,
        url: r.url,
        publishedAt: r.publishedAt.toISOString(),
        views,
        likes,
        engagementRate: engagementPct(likes, views),
        lastObservedAt: r.lastObservedAt.toISOString(),
      };
    })
    .filter((p): p is ClientStateVideo => p !== null);

  return {
    scope: {
      title: scope.title,
      allStates: scope.allStates,
    },
    timezone,
    dataUpdatedAt: dataUpdatedAt ? dataUpdatedAt.toISOString() : null,
    filter: {
      state: matchedState
        ? {
            id: matchedState.id,
            slug: matchedState.slug,
            stateName: matchedState.stateName,
            stateCode: matchedState.stateCode,
          }
        : null,
      from: opts?.from ?? null,
      to: opts?.to ?? null,
      sort,
    },
    total,
    limit,
    offset,
    count: posts.length,
    posts,
  };
}

// ─── CSV Export ───────────────────────────────────────────────────────────────

function csvEscape(value: string | number | null): string {
  const s = value === null ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function stateAccountsVideosCsv(
  videos: ClientStateVideo[],
): string {
  const header =
    "state,state_code,username,url,published_at,views,likes,engagement_rate_pct,last_observed_at";
  const rows = videos.map((v) =>
    [
      v.stateName,
      v.stateCode ?? "",
      v.username ? `@${v.username}` : "",
      v.url,
      v.publishedAt,
      v.views,
      v.likes,
      v.engagementRate,
      v.lastObservedAt,
    ]
      .map(csvEscape)
      .join(","),
  );
  return [header, ...rows].join("\n") + "\n";
}
