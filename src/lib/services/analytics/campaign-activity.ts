/**
 * Campaign daily activity — per-org-timezone-day coverage of the posting →
 * capture → refresh pipeline for one campaign, plus the "uncaptured posts"
 * list and the manual capture action behind the campaign detail page's
 * Daily activity section.
 *
 * Bucketing: all timestamps are stored UTC; every day boundary here is
 * computed in the org timezone (Asia/Kolkata by default) via the shared
 * helpers — never naive server-local time.
 *
 * Attribution note: the ApifyCallLog ledger is global (no campaignId), so
 * sweep/refresh ledger spend cannot be attributed per campaign. The
 * refreshedCount column is therefore derived from VideoStatSnapshot rows
 * joined through TrackedVideo.campaignId (one snapshot is written per
 * refresh/capture stats-write), and no ledger column is shown.
 */

import prisma from "@/lib/db";
import { can } from "@/lib/services/permissions";
import { ForbiddenError } from "@/lib/services/analytics/account-performance";
import { getOrgTimezone, getZonedDateString } from "@/lib/services/timezone";
import { zonedDayBounds, zonedDayString, TERMINAL_PUBLISHED_STATES } from "@/lib/services/analytics/account-stats";
import { captureVideoLink } from "@/lib/services/analytics/capture";
import { apifyProvider } from "@/lib/services/analytics/apify";
import type { AnalyticsProvider } from "@/lib/services/analytics/provider";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 30;
const MAX_DAYS = 366;

async function assertCampaignAccess(userId: string): Promise<void> {
  if (!(await can(userId, "campaigns"))) throw new ForbiddenError();
}

export interface ActivityRange {
  timezone: string;
  from: string; // YYYY-MM-DD in org tz
  to: string;
  start: Date; // UTC instant of `from` 00:00 org tz
  end: Date; // UTC instant of day after `to` 00:00 org tz
}

/** Resolve an optional { from, to } (YYYY-MM-DD, org tz) to concrete bounds. */
async function resolveRange(opts?: { from?: string; to?: string }): Promise<ActivityRange | null> {
  const timezone = await getOrgTimezone();
  const today = zonedDayString(new Date(), timezone);
  const to = opts?.to && /^\d{4}-\d{2}-\d{2}$/.test(opts.to) ? opts.to : today;
  const from =
    opts?.from && /^\d{4}-\d{2}-\d{2}$/.test(opts.from)
      ? opts.from
      : new Date(Date.parse(`${to}T00:00:00Z`) - (DEFAULT_DAYS - 1) * DAY_MS).toISOString().slice(0, 10);
  if (from > to) return null;
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
  if (days > MAX_DAYS) return null;
  const { start } = zonedDayBounds(from, timezone);
  const { end } = zonedDayBounds(to, timezone); // already the next zoned midnight
  return { timezone, from, to, start, end };
}

const DAY_LIST = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); ; t += DAY_MS) {
    const d = new Date(t).toISOString().slice(0, 10);
    out.push(d);
    if (d >= to) break;
  }
  return out;
};

// ── Uncaptured posts ────────────────────────────────────────────────────────

export interface UncapturedPost {
  postJobId: string;
  postedAt: string; // ISO
  day: string; // YYYY-MM-DD in org tz
  accountUsername: string;
  accountDisplayName: string;
  driveFolderName: string | null;
  driveFileName: string | null;
  captureStatus: "none" | "unresolved"; // none = never attempted
  captureAttempts: number;
}

type UncapturedJobRow = {
  id: string;
  publishedAt: Date;
  driveFileName: string | null;
  account: {
    tiktokUsername: string;
    tiktokDisplayName: string;
    driveFolderName: string | null;
  };
};

/**
 * Terminal-published PostJobs of the campaign inside [start, end) that have
 * no captured TrackedVideo (either never attempted, or only an unresolved
 * placeholder). Shared by the list endpoint and the capture action.
 */
async function findUncapturedJobs(
  campaignId: string,
  start: Date,
  end: Date
): Promise<{ jobs: UncapturedJobRow[]; statusByJobId: Map<string, { attempts: number }> }> {
  const jobs = await prisma.postJob.findMany({
    where: {
      campaignId,
      state: { in: TERMINAL_PUBLISHED_STATES },
      publishedAt: { gte: start, lt: end },
    },
    select: {
      id: true,
      publishedAt: true,
      driveFileName: true,
      account: {
        select: { tiktokUsername: true, tiktokDisplayName: true, driveFolderName: true },
      },
    },
    orderBy: { publishedAt: "desc" },
  });
  if (jobs.length === 0) return { jobs: [], statusByJobId: new Map() };

  const tracked = await prisma.trackedVideo.findMany({
    where: { postJobId: { in: jobs.map((j) => j.id) } },
    select: { postJobId: true, status: true, captureAttempts: true },
  });
  const capturedJobIds = new Set(
    tracked.filter((t) => t.status !== "unresolved").map((t) => t.postJobId)
  );
  const statusByJobId = new Map<string, { attempts: number }>();
  for (const t of tracked) {
    if (t.status === "unresolved" && t.postJobId) {
      statusByJobId.set(t.postJobId, { attempts: t.captureAttempts });
    }
  }
  return { jobs: jobs.filter((j) => !capturedJobIds.has(j.id)) as UncapturedJobRow[], statusByJobId };
}

export async function getUncapturedPosts(
  userId: string,
  campaignId: string,
  opts?: { from?: string; to?: string }
): Promise<{ timezone: string; from: string; to: string; posts: UncapturedPost[] } | null> {
  await assertCampaignAccess(userId);
  const range = await resolveRange(opts);
  if (!range) return null;
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { id: true } });
  if (!campaign) return null;

  const { jobs, statusByJobId } = await findUncapturedJobs(campaignId, range.start, range.end);
  return {
    timezone: range.timezone,
    from: range.from,
    to: range.to,
    posts: jobs.map((j) => ({
      postJobId: j.id,
      postedAt: j.publishedAt.toISOString(),
      day: getZonedDateString(j.publishedAt, range.timezone),
      accountUsername: j.account.tiktokUsername,
      accountDisplayName: j.account.tiktokDisplayName,
      driveFolderName: j.account.driveFolderName,
      driveFileName: j.driveFileName,
      captureStatus: statusByJobId.has(j.id) ? "unresolved" : "none",
      captureAttempts: statusByJobId.get(j.id)?.attempts ?? 0,
    })),
  };
}

// ── Daily activity ──────────────────────────────────────────────────────────

export interface CampaignDailyActivityRow {
  date: string; // YYYY-MM-DD in org tz
  postsCount: number; // terminal-published PostJobs that day
  capturedCount: number; // TrackedVideos captured that day
  refreshedCount: number; // campaign videos with a stats snapshot that day
  missingCount: number; // posts that day still without a captured link
}

export interface CampaignDailyActivity {
  timezone: string;
  from: string;
  to: string;
  rows: CampaignDailyActivityRow[]; // newest first
  totals: { postsCount: number; capturedCount: number; refreshedCount: number; missingCount: number };
}

export async function getCampaignDailyActivity(
  userId: string,
  campaignId: string,
  opts?: { from?: string; to?: string }
): Promise<CampaignDailyActivity | null> {
  await assertCampaignAccess(userId);
  const range = await resolveRange(opts);
  if (!range) return null;
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { id: true } });
  if (!campaign) return null;

  const [posts, captures, snapshots, uncaptured] = await Promise.all([
    prisma.postJob.findMany({
      where: {
        campaignId,
        state: { in: TERMINAL_PUBLISHED_STATES },
        publishedAt: { gte: range.start, lt: range.end },
      },
      select: { publishedAt: true },
    }),
    prisma.trackedVideo.findMany({
      where: {
        campaignId,
        status: { not: "unresolved" },
        capturedAt: { gte: range.start, lt: range.end },
      },
      select: { capturedAt: true },
    }),
    prisma.videoStatSnapshot.findMany({
      where: { trackedVideo: { campaignId }, recordedAt: { gte: range.start, lt: range.end } },
      select: { trackedVideoId: true, recordedAt: true },
    }),
    findUncapturedJobs(campaignId, range.start, range.end),
  ]);

  const dayList = DAY_LIST(range.from, range.to);
  const byDay = new Map<string, CampaignDailyActivityRow>(
    dayList.map((d) => [d, { date: d, postsCount: 0, capturedCount: 0, refreshedCount: 0, missingCount: 0 }])
  );
  const bump = (isoDay: string, fn: (r: CampaignDailyActivityRow) => void) => {
    const row = byDay.get(isoDay);
    if (row) fn(row);
  };

  for (const p of posts) {
    bump(getZonedDateString(p.publishedAt!, range.timezone), (r) => r.postsCount++);
  }
  for (const c of captures) {
    bump(getZonedDateString(c.capturedAt, range.timezone), (r) => r.capturedCount++);
  }
  // Distinct videos per day — one video refreshed 3× in a day counts once.
  const refreshedByDay = new Map<string, Set<string>>();
  for (const s of snapshots) {
    const day = getZonedDateString(s.recordedAt, range.timezone);
    if (!byDay.has(day)) continue;
    const set = refreshedByDay.get(day) ?? new Set<string>();
    set.add(s.trackedVideoId);
    refreshedByDay.set(day, set);
  }
  for (const [day, set] of refreshedByDay) {
    const row = byDay.get(day);
    if (row) row.refreshedCount = set.size;
  }
  for (const j of uncaptured.jobs) {
    bump(getZonedDateString(j.publishedAt, range.timezone), (r) => r.missingCount++);
  }

  const rows = [...byDay.values()].reverse(); // newest first
  const totals = rows.reduce(
    (acc, r) => ({
      postsCount: acc.postsCount + r.postsCount,
      capturedCount: acc.capturedCount + r.capturedCount,
      refreshedCount: acc.refreshedCount + r.refreshedCount,
      missingCount: acc.missingCount + r.missingCount,
    }),
    { postsCount: 0, capturedCount: 0, refreshedCount: 0, missingCount: 0 }
  );

  return { timezone: range.timezone, from: range.from, to: range.to, rows, totals };
}

// ── Capture action ──────────────────────────────────────────────────────────

export interface CaptureUncapturedResult {
  attempted: number;
  captured: number;
  unresolved: number; // still without a link after the run (includes skipped)
}

/**
 * Manually run the existing time-window capture (captureVideoLink) for every
 * uncaptured post of the campaign, optionally limited to one org-tz day.
 * Idempotent: captureVideoLink early-returns for already-captured jobs and
 * upserts the unresolved placeholder otherwise, so re-running never
 * double-captures (tiktokVideoId is globally unique).
 */
export async function captureUncapturedPosts(
  userId: string,
  campaignId: string,
  opts?: { date?: string },
  provider: AnalyticsProvider = apifyProvider
): Promise<CaptureUncapturedResult | null> {
  await assertCampaignAccess(userId);
  const timezone = await getOrgTimezone();
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { id: true } });
  if (!campaign) return null;

  let start: Date;
  let end: Date;
  if (opts?.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) return null;
    const bounds = zonedDayBounds(opts.date, timezone);
    start = bounds.start;
    end = bounds.end;
  } else {
    // "Capture all missing" covers every uncaptured post of the campaign.
    start = new Date(0);
    end = new Date();
  }

  const { jobs } = await findUncapturedJobs(campaignId, start, end);
  const result: CaptureUncapturedResult = { attempted: 0, captured: 0, unresolved: 0 };
  for (const job of jobs) {
    result.attempted++;
    const res = await captureVideoLink(job.id, provider);
    if (res.status === "captured") result.captured++;
    else result.unresolved++;
  }
  console.log(
    `[CampaignActivity] Campaign ${campaignId} capture-uncaptured${opts?.date ? ` (${opts.date})` : ""}: attempted=${result.attempted} captured=${result.captured} unresolved=${result.unresolved}`
  );
  return result;
}
