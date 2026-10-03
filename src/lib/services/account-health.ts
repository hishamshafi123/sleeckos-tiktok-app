/**
 * Account Health Scan (shadowban detection). A scan is a single background
 * pass over every managed account: it compares each account's most recent
 * captured TrackedVideos against configurable view floors and writes one
 * AccountHealthEntry per account. Flagged accounts get the "Shadowbanned"
 * AccountLabel; accounts that recover to HEALTHY get it removed. Assignment
 * state (assigneeId / replacementStatus) is carried forward from the previous
 * scan so in-flight replacement work isn't lost between runs.
 */

import prisma from "@/lib/db";
import { can } from "@/lib/services/permissions";
import { ForbiddenError } from "@/lib/services/analytics/account-performance";
import { TERMINAL_PUBLISHED_STATES } from "@/lib/services/analytics/account-stats";
import { createTicket } from "@/lib/services/tickets";

export class ScanAlreadyRunningError extends Error {
  constructor() {
    super("Scan already running");
    this.name = "ScanAlreadyRunningError";
  }
}

/** 400-style validation error (mirrors TicketError's shape). */
export class HealthScanError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "HealthScanError";
    this.status = status;
  }
}

export const HEALTH_VERDICTS = ["HEALTHY", "SUSPECT", "SHADOWBANNED", "NOT_POSTING", "NO_DATA"] as const;
export type HealthVerdict = (typeof HEALTH_VERDICTS)[number];

export type HealthThresholds = {
  viewFloor: number;
  sampleSize: number;
  matureAgeHours: number;
  staleDays: number;
  notPostingDays: number;
};

export const DEFAULT_HEALTH_THRESHOLDS: HealthThresholds = {
  viewFloor: 100,
  sampleSize: 3,
  matureAgeHours: 24,
  staleDays: 3,
  notPostingDays: 3,
};

// Verdict sort order for the results table (most urgent first).
const SEVERITY_ORDER: Record<HealthVerdict, number> = {
  SHADOWBANNED: 0,
  SUSPECT: 1,
  NOT_POSTING: 2,
  NO_DATA: 3,
  HEALTHY: 4,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const BASELINE_SAMPLE = 10;
const SHADOWBANNED_LABEL_NAME = "Shadowbanned";

export type HealthScanProgress = {
  running: boolean;
  processed: number;
  total: number;
  scanId: string | null;
  error: string | null;
};

// Module-level singleton — one scan in flight per server process.
const progress: HealthScanProgress = {
  running: false,
  processed: 0,
  total: 0,
  scanId: null,
  error: null,
};

async function assertAccess(userId: string): Promise<void> {
  if (!(await can(userId, "analytics"))) throw new ForbiddenError();
}

function mergeThresholds(t?: Partial<HealthThresholds> | null): HealthThresholds {
  const pick = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return {
    viewFloor: pick(t?.viewFloor, DEFAULT_HEALTH_THRESHOLDS.viewFloor),
    sampleSize: pick(t?.sampleSize, DEFAULT_HEALTH_THRESHOLDS.sampleSize),
    matureAgeHours: pick(t?.matureAgeHours, DEFAULT_HEALTH_THRESHOLDS.matureAgeHours),
    staleDays: pick(t?.staleDays, DEFAULT_HEALTH_THRESHOLDS.staleDays),
    notPostingDays: pick(t?.notPostingDays, DEFAULT_HEALTH_THRESHOLDS.notPostingDays),
  };
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDay(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

type CapturedVideo = {
  accountId: string;
  url: string;
  views: bigint;
  publishedAt: Date;
  lastRefreshedAt: Date | null;
};

type RecentPost = { url: string; publishedAt: string; views: number };

type VerdictResult = {
  verdict: HealthVerdict;
  reason: string;
  lastPostAt: Date | null;
  recentPosts: RecentPost[];
  baselineViews: number | null;
};

function computeVerdict(
  lastPostAt: Date | null,
  videos: CapturedVideo[], // captured only, sorted publishedAt desc
  t: HealthThresholds,
  now: number
): VerdictResult {
  // NOT_POSTING — nothing published recently (or ever).
  if (!lastPostAt) {
    return { verdict: "NOT_POSTING", reason: "No published posts", lastPostAt: null, recentPosts: [], baselineViews: null };
  }
  if (now - lastPostAt.getTime() > t.notPostingDays * DAY_MS) {
    return { verdict: "NOT_POSTING", reason: `No posts since ${fmtDay(lastPostAt)}`, lastPostAt, recentPosts: [], baselineViews: null };
  }

  const recent = videos.slice(0, t.sampleSize);
  const baselineSet = videos.slice(t.sampleSize, t.sampleSize + BASELINE_SAMPLE);
  const recentViews = recent.map((v) => Number(v.views));
  const baselineViews = median(baselineSet.map((v) => Number(v.views)));
  const recentPosts: RecentPost[] = recent.map((v) => ({
    url: v.url,
    publishedAt: v.publishedAt.toISOString(),
    views: Number(v.views),
  }));

  // NO_DATA — not enough captured posts to judge.
  if (recent.length < t.sampleSize) {
    return {
      verdict: "NO_DATA",
      reason: `Only ${recent.length} captured post${recent.length === 1 ? "" : "s"}`,
      lastPostAt,
      recentPosts,
      baselineViews,
    };
  }

  // NO_DATA — stats pipeline stale for this account.
  let maxRefreshed: Date | null = null;
  for (const v of videos) {
    if (v.lastRefreshedAt && (!maxRefreshed || v.lastRefreshedAt > maxRefreshed)) {
      maxRefreshed = v.lastRefreshedAt;
    }
  }
  if (!maxRefreshed) {
    return { verdict: "NO_DATA", reason: "Stats never refreshed", lastPostAt, recentPosts, baselineViews };
  }
  if (now - maxRefreshed.getTime() > t.staleDays * DAY_MS) {
    const days = Math.floor((now - maxRefreshed.getTime()) / DAY_MS);
    return {
      verdict: "NO_DATA",
      reason: `Stats stale (last refresh ${days}d ago)`,
      lastPostAt,
      recentPosts,
      baselineViews,
    };
  }

  // NO_DATA — a recent post is too young for its views to have matured.
  if (recent.some((v) => now - v.publishedAt.getTime() < t.matureAgeHours * HOUR_MS)) {
    return {
      verdict: "NO_DATA",
      reason: `Recent post younger than ${t.matureAgeHours}h — views not matured`,
      lastPostAt,
      recentPosts,
      baselineViews,
    };
  }

  const atOrBelowFloor = recentViews.filter((v) => v <= t.viewFloor).length;
  const viewsList = recentViews.join(", ");

  // SHADOWBANNED — every recent post at/below the floor.
  if (atOrBelowFloor === recentViews.length) {
    return {
      verdict: "SHADOWBANNED",
      reason: `Last ${recentViews.length} posts all ≤${t.viewFloor} views: ${viewsList}`,
      lastPostAt,
      recentPosts,
      baselineViews,
    };
  }

  // SUSPECT — all but one at/below the floor, or the average is.
  const avg = recentViews.reduce((a, b) => a + b, 0) / recentViews.length;
  if (atOrBelowFloor >= t.sampleSize - 1 || avg <= t.viewFloor) {
    return {
      verdict: "SUSPECT",
      reason: `Last ${recentViews.length} posts: ${viewsList} views`,
      lastPostAt,
      recentPosts,
      baselineViews,
    };
  }

  return {
    verdict: "HEALTHY",
    reason: `Last ${recentViews.length} posts: ${viewsList} views`,
    lastPostAt,
    recentPosts,
    baselineViews,
  };
}

async function executeHealthScan(scanId: string, t: HealthThresholds): Promise<void> {
  const now = Date.now();
  try {
    // a. All accounts.
    const accounts = await prisma.managedAccount.findMany({
      select: {
        id: true,
        tiktokUsername: true,
        driveFolderName: true,
        sectionId: true,
        section: { select: { name: true } },
      },
    });
    progress.total = accounts.length;

    // b. Last published PostJob per account.
    const lastPosts = await prisma.postJob.groupBy({
      by: ["accountId"],
      where: { state: { in: [...TERMINAL_PUBLISHED_STATES] }, publishedAt: { not: null } },
      _max: { publishedAt: true },
    });
    const lastPostMap = new Map<string, Date>();
    for (const row of lastPosts) {
      if (row._max.publishedAt) lastPostMap.set(row.accountId, row._max.publishedAt);
    }

    // c. ONE query for all captured videos, grouped + sorted in JS.
    const videos = await prisma.trackedVideo.findMany({
      where: { status: "captured" },
      select: { accountId: true, url: true, views: true, publishedAt: true, lastRefreshedAt: true },
    });
    const videosByAccount = new Map<string, CapturedVideo[]>();
    for (const v of videos) {
      const list = videosByAccount.get(v.accountId);
      if (list) list.push(v);
      else videosByAccount.set(v.accountId, [v]);
    }
    for (const list of videosByAccount.values()) {
      list.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
    }

    // d. Carry forward assignment state from the latest previous finished scan.
    const carryMap = new Map<string, { assigneeId: string | null; replacementStatus: string }>();
    const prevScan = await prisma.accountHealthScan.findFirst({
      where: { status: "done", id: { not: scanId } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (prevScan) {
      const prevEntries = await prisma.accountHealthEntry.findMany({
        where: { scanId: prevScan.id, replacementStatus: { in: ["OPEN", "ASSIGNED"] } },
        select: { accountId: true, assigneeId: true, replacementStatus: true },
      });
      for (const e of prevEntries) {
        carryMap.set(e.accountId, { assigneeId: e.assigneeId, replacementStatus: e.replacementStatus });
      }
    }

    // e. Compute verdicts and write entries.
    const counts: Record<HealthVerdict, number> = {
      HEALTHY: 0,
      SUSPECT: 0,
      SHADOWBANNED: 0,
      NOT_POSTING: 0,
      NO_DATA: 0,
    };
    const entryRows: {
      scanId: string;
      accountId: string;
      verdict: string;
      reason: string;
      lastPostAt: Date | null;
      recentPostsJson: RecentPost[];
      baselineViews: number | null;
      assigneeId: string | null;
      replacementStatus: string;
    }[] = [];

    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      const result = computeVerdict(
        lastPostMap.get(account.id) ?? null,
        videosByAccount.get(account.id) ?? [],
        t,
        now
      );
      counts[result.verdict]++;
      const carry = carryMap.get(account.id);
      entryRows.push({
        scanId,
        accountId: account.id,
        verdict: result.verdict,
        reason: result.reason,
        lastPostAt: result.lastPostAt,
        recentPostsJson: result.recentPosts,
        baselineViews: result.baselineViews,
        assigneeId: carry?.assigneeId ?? null,
        replacementStatus: carry?.replacementStatus ?? "OPEN",
      });
      progress.processed = i + 1;
    }

    for (let i = 0; i < entryRows.length; i += 500) {
      await prisma.accountHealthEntry.createMany({ data: entryRows.slice(i, i + 500) });
    }

    await prisma.accountHealthScan.update({
      where: { id: scanId },
      data: { status: "done", countsJson: counts, finishedAt: new Date() },
    });

    // f. "Shadowbanned" label management — only ever touches that one label.
    const shadowbannedIds = entryRows.filter((e) => e.verdict === "SHADOWBANNED").map((e) => e.accountId);
    const healthyIds = entryRows.filter((e) => e.verdict === "HEALTHY").map((e) => e.accountId);
    if (shadowbannedIds.length > 0 || healthyIds.length > 0) {
      const label = await prisma.accountLabel.upsert({
        where: { name: SHADOWBANNED_LABEL_NAME },
        update: {},
        create: { name: SHADOWBANNED_LABEL_NAME, color: "red" },
      });
      if (shadowbannedIds.length > 0) {
        await prisma.accountLabelAssignment.createMany({
          data: shadowbannedIds.map((accountId) => ({ accountId, labelId: label.id })),
          skipDuplicates: true,
        });
      }
      if (healthyIds.length > 0) {
        await prisma.accountLabelAssignment.deleteMany({
          where: { labelId: label.id, accountId: { in: healthyIds } },
        });
      }
    }
  } catch (err: any) {
    const message = err?.message ?? "Unknown error";
    progress.error = message;
    await prisma.accountHealthScan
      .update({ where: { id: scanId }, data: { status: "failed", error: message, finishedAt: new Date() } })
      .catch(() => {});
  } finally {
    progress.running = false;
  }
}

export async function runHealthScan(
  userId: string,
  thresholds?: Partial<HealthThresholds>
): Promise<{ scanId: string; status: "running" }> {
  await assertAccess(userId);
  if (progress.running) throw new ScanAlreadyRunningError();

  const t = mergeThresholds(thresholds);
  const scan = await prisma.accountHealthScan.create({
    data: { createdBy: userId, status: "running", thresholdsJson: t },
  });

  progress.running = true;
  progress.processed = 0;
  progress.total = 0;
  progress.scanId = scan.id;
  progress.error = null;

  // Fire-and-forget: executeHealthScan never throws (it marks the scan row
  // failed); the catch is a last-resort log.
  (async () => {
    try {
      await executeHealthScan(scan.id, t);
    } catch (err) {
      console.error("[AccountHealth] Background scan failed:", err);
    }
  })();

  return { scanId: scan.id, status: "running" };
}

export function getHealthScanStatus(): HealthScanProgress {
  return { ...progress };
}

export async function getHealthScanStatusFor(userId: string): Promise<HealthScanProgress> {
  await assertAccess(userId);
  return getHealthScanStatus();
}

function zeroCounts(): Record<HealthVerdict, number> {
  return { HEALTHY: 0, SUSPECT: 0, SHADOWBANNED: 0, NOT_POSTING: 0, NO_DATA: 0 };
}

export async function getLatestHealthScan(
  userId: string,
  opts: { verdicts?: string[]; assigneeId?: string; query?: string; page?: number; pageSize?: number } = {}
) {
  await assertAccess(userId);

  const page = Math.max(1, Math.floor(opts.page ?? 1) || 1);
  const pageSize = Math.min(200, Math.max(1, Math.floor(opts.pageSize ?? 50) || 50));

  const scan = await prisma.accountHealthScan.findFirst({
    where: { status: "done" },
    orderBy: { createdAt: "desc" },
  });

  if (!scan) {
    return { scan: null, counts: zeroCounts(), page, pageSize, total: 0, entries: [] };
  }

  // Full per-verdict counts for the scan (unfiltered).
  const countRows = await prisma.accountHealthEntry.groupBy({
    by: ["verdict"],
    where: { scanId: scan.id },
    _count: { _all: true },
  });
  const counts = zeroCounts();
  for (const row of countRows) {
    if (row.verdict in counts) counts[row.verdict as HealthVerdict] = row._count._all;
  }

  const where: any = { scanId: scan.id };
  if (opts.verdicts && opts.verdicts.length > 0) {
    where.verdict = { in: opts.verdicts };
  }
  if (opts.assigneeId) {
    where.assigneeId = opts.assigneeId;
  }
  if (opts.query) {
    const matching = await prisma.managedAccount.findMany({
      where: {
        OR: [
          { tiktokUsername: { contains: opts.query, mode: "insensitive" } },
          { driveFolderName: { contains: opts.query, mode: "insensitive" } },
        ],
      },
      select: { id: true },
    });
    where.accountId = { in: matching.map((a) => a.id) };
  }

  const total = await prisma.accountHealthEntry.count({ where });
  const entries = await prisma.accountHealthEntry.findMany({
    where,
    include: { assignee: { select: { id: true, name: true, email: true } } },
  });

  const accountIds = [...new Set(entries.map((e) => e.accountId))];
  const accounts = accountIds.length
    ? await prisma.managedAccount.findMany({
        where: { id: { in: accountIds } },
        select: { id: true, tiktokUsername: true, driveFolderName: true, section: { select: { name: true } } },
      })
    : [];
  const accountMap = new Map(accounts.map((a) => [a.id, a]));

  const sorted = entries.sort((a, b) => {
    const sevA = SEVERITY_ORDER[a.verdict as HealthVerdict] ?? 99;
    const sevB = SEVERITY_ORDER[b.verdict as HealthVerdict] ?? 99;
    if (sevA !== sevB) return sevA - sevB;
    // lastPostAt asc, nulls first.
    if (a.lastPostAt === null && b.lastPostAt === null) return 0;
    if (a.lastPostAt === null) return -1;
    if (b.lastPostAt === null) return 1;
    return a.lastPostAt.getTime() - b.lastPostAt.getTime();
  });

  const pageEntries = sorted.slice((page - 1) * pageSize, page * pageSize);

  return {
    scan: {
      id: scan.id,
      createdAt: scan.createdAt.toISOString(),
      finishedAt: scan.finishedAt ? scan.finishedAt.toISOString() : null,
      status: scan.status,
      thresholds: mergeThresholds(scan.thresholdsJson as Partial<HealthThresholds>),
    },
    counts,
    page,
    pageSize,
    total,
    entries: pageEntries.map((e) => {
      const account = accountMap.get(e.accountId);
      return {
        id: e.id,
        accountId: e.accountId,
        accountName: account ? account.tiktokUsername : `@${e.accountId.slice(0, 8)}`,
        driveFolderName: account?.driveFolderName ?? null,
        sectionName: account?.section?.name ?? null,
        verdict: e.verdict,
        reason: e.reason,
        lastPostAt: e.lastPostAt ? e.lastPostAt.toISOString() : null,
        recentPosts: (e.recentPostsJson as RecentPost[]) ?? [],
        baselineViews: e.baselineViews,
        assignee: e.assignee
          ? { id: e.assignee.id, name: e.assignee.name, email: e.assignee.email }
          : null,
        replacementStatus: e.replacementStatus,
      };
    }),
  };
}

export async function assignHealthEntries(
  userId: string,
  entryIds: string[],
  assigneeId: string
): Promise<{ assigned: number; ticketId: string }> {
  await assertAccess(userId);

  const assignee = await prisma.user.findUnique({ where: { id: assigneeId } });
  if (!assignee) throw new HealthScanError("Assignee not found");

  const scan = await prisma.accountHealthScan.findFirst({
    where: { status: "done" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!scan) throw new HealthScanError("No finished scan");

  const entries = await prisma.accountHealthEntry.findMany({
    where: { id: { in: entryIds }, scanId: scan.id },
  });
  if (entries.length === 0) {
    throw new HealthScanError("No matching entries in the latest scan");
  }

  await prisma.accountHealthEntry.updateMany({
    where: { id: { in: entries.map((e) => e.id) } },
    data: { assigneeId, replacementStatus: "ASSIGNED" },
  });

  const accountIds = [...new Set(entries.map((e) => e.accountId))];
  const accounts = await prisma.managedAccount.findMany({
    where: { id: { in: accountIds } },
    select: { id: true, tiktokUsername: true },
  });
  const nameOf = (accountId: string) =>
    accounts.find((a) => a.id === accountId)?.tiktokUsername ?? `@${accountId.slice(0, 8)}`;

  const names = entries.map((e) => `@${nameOf(e.accountId)}`);
  const shown = names.slice(0, 5).join(", ");
  const title = `Replace ${entries.length} flagged account${entries.length === 1 ? "" : "s"}: ${shown}${
    names.length > 5 ? ` and ${names.length - 5} more` : ""
  }`;

  const lines = entries.map((e) => {
    const recent = ((e.recentPostsJson as RecentPost[]) ?? []).map((p) => p.views);
    const viewsText = recent.length > 0 ? `last ${recent.length}: ${recent.join(", ")} views` : "no recent posts";
    return `- @${nameOf(e.accountId)} — ${e.verdict}: ${e.reason} (${viewsText})`;
  });
  const description = `Health scan flagged ${entries.length} account${
    entries.length === 1 ? "" : "s"
  } for replacement:\n\n${lines.join("\n")}`;

  const ticket = await createTicket(userId, {
    title,
    description,
    priority: "HIGH",
    assigneeId,
  });

  return { assigned: entries.length, ticketId: ticket.id };
}

const ENTRY_ACTIONS: Record<string, string> = {
  dismiss: "DISMISSED",
  reopen: "OPEN",
  "mark-replaced": "REPLACED",
};

export async function healthEntryAction(
  userId: string,
  entryId: string,
  action: string
): Promise<{ ok: true; replacementStatus: string }> {
  await assertAccess(userId);

  const replacementStatus = ENTRY_ACTIONS[action];
  if (!replacementStatus) throw new HealthScanError("Invalid action");

  const entry = await prisma.accountHealthEntry.findUnique({ where: { id: entryId } });
  if (!entry) throw new HealthScanError("Entry not found");

  await prisma.accountHealthEntry.update({
    where: { id: entryId },
    data: { replacementStatus },
  });

  return { ok: true, replacementStatus };
}
