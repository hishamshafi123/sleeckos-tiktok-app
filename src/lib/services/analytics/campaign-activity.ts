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
import type { Prisma } from "@prisma/client";
import { can } from "@/lib/services/permissions";
import { ForbiddenError } from "@/lib/services/analytics/account-performance";
import { getOrgTimezone, getZonedDateString } from "@/lib/services/timezone";
import { zonedDayBounds, zonedDayString, TERMINAL_PUBLISHED_STATES } from "@/lib/services/analytics/account-stats";
import { captureAccountPosts, captureDepth } from "@/lib/services/analytics/capture";
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
  accountId: string;
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
 * placeholder). Shared by the list endpoint and the capture action. When
 * `accountIds` is given, only jobs on those accounts are returned (used to
 * expand a day-scoped capture run to the affected accounts' whole backlog).
 */
async function findUncapturedJobs(
  campaignId: string,
  start: Date,
  end: Date,
  accountIds?: string[]
): Promise<{ jobs: UncapturedJobRow[]; statusByJobId: Map<string, { attempts: number }> }> {
  const jobs = await prisma.postJob.findMany({
    where: {
      campaignId,
      state: { in: TERMINAL_PUBLISHED_STATES },
      publishedAt: { gte: start, lt: end },
      ...(accountIds ? { accountId: { in: accountIds } } : {}),
    },
    select: {
      id: true,
      accountId: true,
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
  lastCapturedAt: string | null; // ISO — latest real capture across the campaign's tracked videos
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

  const [posts, captures, snapshots, uncaptured, lastCapture] = await Promise.all([
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
    // Latest real capture across the whole campaign (not range-scoped) — powers
    // the "Last capture: …" header line in the Daily Activity card.
    prisma.trackedVideo.findFirst({
      where: { campaignId, status: { not: "unresolved" } },
      orderBy: { capturedAt: "desc" },
      select: { capturedAt: true },
    }),
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

  return {
    timezone: range.timezone,
    from: range.from,
    to: range.to,
    rows,
    totals,
    lastCapturedAt: lastCapture ? lastCapture.capturedAt.toISOString() : null,
  };
}

// ── Per-day captured videos (day expansion in the Daily Activity card) ──────

export interface DayCapturedVideo {
  id: string;
  url: string;
  accountUsername: string;
  views: number;
  capturedAt: string; // ISO
}

/**
 * Captured (non-unresolved) TrackedVideos of the campaign whose capturedAt
 * falls inside the given org-tz day — the "captured" group of a day
 * expansion, mirroring the Captured column of the activity table.
 */
export async function getCampaignDayCaptured(
  userId: string,
  campaignId: string,
  date: string
): Promise<{ timezone: string; date: string; videos: DayCapturedVideo[] } | null> {
  await assertCampaignAccess(userId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const timezone = await getOrgTimezone();
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { id: true } });
  if (!campaign) return null;

  const { start, end } = zonedDayBounds(date, timezone);
  const videos = await prisma.trackedVideo.findMany({
    where: { campaignId, status: { not: "unresolved" }, capturedAt: { gte: start, lt: end } },
    orderBy: { capturedAt: "desc" },
    take: 200,
    select: { id: true, url: true, views: true, capturedAt: true, accountId: true },
  });
  const accountIds = [...new Set(videos.map((v) => v.accountId))];
  const accounts = await prisma.managedAccount.findMany({
    where: { id: { in: accountIds } },
    select: { id: true, tiktokUsername: true },
  });
  const usernameById = new Map(accounts.map((a) => [a.id, a.tiktokUsername]));

  return {
    timezone,
    date,
    videos: videos.map((v) => ({
      id: v.id,
      url: v.url,
      accountUsername: usernameById.get(v.accountId) ?? "",
      views: Number(v.views),
      capturedAt: v.capturedAt.toISOString(),
    })),
  };
}

// ── Capture action (CaptureRun-backed, live progress) ───────────────────────

export interface CaptureUncapturedResult {
  attempted: number;
  captured: number;
  unresolved: number; // still without a link after the run (includes skipped)
}

export interface CaptureRunPostDetail {
  postJobId: string;
  account: string;
  result: "captured" | "unresolved";
  url?: string;
}

/** One entry per account scraped in the run (capture is per-account now). */
export interface CaptureRunAccountDetail {
  account: string;
  scraped: boolean; // false when nothing was left to capture (raced) — no provider call made
  depthUsed: number; // latest-videos fetch depth (CAPTURE_DEPTH)
  refreshed: number; // already-captured videos stats-refreshed for free by the same fetch
}

export type CaptureRunDetailEntry = CaptureRunPostDetail | CaptureRunAccountDetail;

export interface CaptureRunSummary {
  id: string;
  day: string | null; // org-tz day filter; null = whole range
  status: string; // running | done | failed
  attempted: number;
  captured: number;
  unresolved: number;
  total: number;
  processed: number;
  error: string | null;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  triggeredBy: string | null; // display name or email of the triggering user
}

export interface CaptureRunDetail extends CaptureRunSummary {
  details: CaptureRunDetailEntry[];
}

/**
 * Shared prep for both entry points: permission + campaign checks, resolves
 * the org-tz day filter, finds the uncaptured jobs, and creates the
 * CaptureRun row up front with `total` known. Returns null on a bad
 * campaign/date (callers map that to 404).
 *
 * Day-scoped runs EXPAND to whole accounts: capture is per-account (one
 * scrape per account regardless of post count), so once a day brings an
 * account into the run, ALL of that account's uncaptured posts in the
 * campaign are targeted — clicking capture for a 4-day-old day also fixes
 * that account's 3d/2d backlog at zero extra scrape cost. `total` therefore
 * counts the uncaptured posts across all affected accounts, not just the
 * selected day's.
 */
async function prepareCaptureRun(
  userId: string,
  campaignId: string,
  opts?: { date?: string }
): Promise<{ runId: string; jobs: UncapturedJobRow[]; date: string | null } | null> {
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

  let { jobs } = await findUncapturedJobs(campaignId, start, end);
  if (opts?.date && jobs.length > 0) {
    const accountIds = [...new Set(jobs.map((j) => j.accountId))];
    jobs = (await findUncapturedJobs(campaignId, new Date(0), new Date(), accountIds)).jobs;
  }
  const run = await prisma.captureRun.create({
    data: { campaignId, userId, day: opts?.date ?? null, total: jobs.length },
  });
  return { runId: run.id, jobs, date: opts?.date ?? null };
}

/**
 * Process a prepared run grouped BY ACCOUNT: one captureAccountPosts call
 * (= one provider scrape) per affected account, then each targeted post's
 * TrackedVideo row is re-checked for its outcome. The CaptureRun row
 * (processed/attempted/captured/unresolved + details) is updated after every
 * post so pollers see live progress; details carry one account-level entry
 * ({account, scraped, depthUsed, refreshed}) plus one per-post entry as
 * before. Marks the run done at the end; throws are left to the caller
 * (startCaptureRun records them as failed). Per-post failures never throw —
 * captureAccountPosts catches its own errors and the affected posts simply
 * re-check as unresolved.
 *
 * Idempotent: already-captured jobs re-check as captured without a new
 * scrape, and unresolved placeholders are upserted, so re-running never
 * double-captures (tiktokVideoId is globally unique).
 */
export async function runCapturePass(
  runId: string,
  jobs: UncapturedJobRow[],
  provider: AnalyticsProvider = apifyProvider
): Promise<CaptureUncapturedResult> {
  const counters = { attempted: 0, captured: 0, unresolved: 0, processed: 0 };
  const details: CaptureRunDetailEntry[] = [];
  const saveProgress = async (status?: string, error?: string) => {
    await prisma.captureRun.update({
      where: { id: runId },
      data: {
        ...counters,
        details: details as unknown as Prisma.InputJsonValue,
        ...(status ? { status } : {}),
        ...(error !== undefined ? { error } : {}),
      },
    });
  };

  const byAccount = new Map<string, UncapturedJobRow[]>();
  for (const job of jobs) {
    const list = byAccount.get(job.accountId) ?? [];
    list.push(job);
    byAccount.set(job.accountId, list);
  }

  for (const [accountId, accountJobs] of byAccount) {
    const username = accountJobs[0].account.tiktokUsername;
    const res = await captureAccountPosts(accountId, {}, provider);
    details.push({
      account: username,
      scraped: res.attempted > 0,
      depthUsed: res.attempted > 0 ? captureDepth() : 0,
      refreshed: res.refreshed,
    });
    for (const job of accountJobs) {
      counters.attempted++;
      counters.processed++;
      const tv = await prisma.trackedVideo.findFirst({
        where: { postJobId: job.id, status: { not: "unresolved" } },
        select: { url: true },
      });
      if (tv) {
        counters.captured++;
        details.push({
          postJobId: job.id,
          account: username,
          result: "captured",
          ...(tv.url ? { url: tv.url } : {}),
        });
      } else {
        counters.unresolved++;
        details.push({ postJobId: job.id, account: username, result: "unresolved" });
      }
      await saveProgress();
    }
  }

  await saveProgress("done");
  console.log(
    `[CampaignActivity] Capture run ${runId} done: accounts=${byAccount.size} attempted=${counters.attempted} captured=${counters.captured} unresolved=${counters.unresolved}`
  );
  return { attempted: counters.attempted, captured: counters.captured, unresolved: counters.unresolved };
}

/**
 * Start a capture run in the background: creates the CaptureRun row (total
 * known up front) and kicks processing off in-process, returning the run id
 * immediately. Same fire-and-forget pattern as recoverCampaignLinks — the
 * client polls GET capture-runs/[runId] for progress.
 */
export async function startCaptureRun(
  userId: string,
  campaignId: string,
  opts?: { date?: string },
  provider: AnalyticsProvider = apifyProvider
): Promise<{ runId: string; total: number } | null> {
  const prepared = await prepareCaptureRun(userId, campaignId, opts);
  if (!prepared) return null;

  (async () => {
    try {
      await runCapturePass(prepared.runId, prepared.jobs, provider);
    } catch (err: any) {
      console.error(`[CampaignActivity] Capture run ${prepared.runId} crashed:`, err?.message || err);
      await prisma.captureRun
        .update({
          where: { id: prepared.runId },
          data: { status: "failed", error: err?.message || String(err) },
        })
        .catch(() => {});
    }
  })();

  return { runId: prepared.runId, total: prepared.jobs.length };
}

/**
 * Backward-compatible awaited form: runs the whole capture synchronously and
 * returns the final counts (plus the run id). The API route uses
 * startCaptureRun instead; this remains for tests/scratch callers.
 */
export async function captureUncapturedPosts(
  userId: string,
  campaignId: string,
  opts?: { date?: string },
  provider: AnalyticsProvider = apifyProvider
): Promise<(CaptureUncapturedResult & { runId: string }) | null> {
  const prepared = await prepareCaptureRun(userId, campaignId, opts);
  if (!prepared) return null;
  try {
    const result = await runCapturePass(prepared.runId, prepared.jobs, provider);
    console.log(
      `[CampaignActivity] Campaign ${campaignId} capture-uncaptured${prepared.date ? ` (${prepared.date})` : ""}: attempted=${result.attempted} captured=${result.captured} unresolved=${result.unresolved}`
    );
    return { ...result, runId: prepared.runId };
  } catch (err: any) {
    await prisma.captureRun
      .update({
        where: { id: prepared.runId },
        data: { status: "failed", error: err?.message || String(err) },
      })
      .catch(() => {});
    throw err;
  }
}

function toRunSummary(
  run: {
    id: string;
    day: string | null;
    status: string;
    attempted: number;
    captured: number;
    unresolved: number;
    total: number;
    processed: number;
    error: string | null;
    userId: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  userLabelById: Map<string, string>
): CaptureRunSummary {
  return {
    id: run.id,
    day: run.day,
    status: run.status,
    attempted: run.attempted,
    captured: run.captured,
    unresolved: run.unresolved,
    total: run.total,
    processed: run.processed,
    error: run.error,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    triggeredBy: run.userId ? userLabelById.get(run.userId) ?? null : null,
  };
}

async function resolveUserLabels(userIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (ids.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, email: true },
  });
  return new Map(users.map((u) => [u.id, u.name || u.email]));
}

/** Last ~20 capture runs for the campaign, newest first (no per-post details). */
export async function listCaptureRuns(
  userId: string,
  campaignId: string
): Promise<CaptureRunSummary[] | null> {
  await assertCampaignAccess(userId);
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { id: true } });
  if (!campaign) return null;

  const runs = await prisma.captureRun.findMany({
    where: { campaignId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const labels = await resolveUserLabels(runs.map((r) => r.userId));
  return runs.map((r) => toRunSummary(r, labels));
}

/** One capture run (with per-post details) — the polling endpoint. */
export async function getCaptureRun(
  userId: string,
  campaignId: string,
  runId: string
): Promise<CaptureRunDetail | null> {
  await assertCampaignAccess(userId);
  const run = await prisma.captureRun.findFirst({ where: { id: runId, campaignId } });
  if (!run) return null;

  const labels = await resolveUserLabels([run.userId]);
  const details = Array.isArray(run.details) ? (run.details as unknown as CaptureRunDetailEntry[]) : [];
  return { ...toRunSummary(run, labels), details };
}
