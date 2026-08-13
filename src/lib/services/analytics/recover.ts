/**
 * Caption-match recovery — links terminal-published PostJobs that the
 * time-window capture (capture.ts) missed back to their TikTok videos by
 * matching the video description against the campaign's fixed caption pool.
 *
 * Post captions are built as "<one random pick from campaign.fixedTexts> +
 * hashtags" (see buildPostCaption in posting-pipeline.ts), so the TikTok
 * description STARTS WITH one of the campaign's fixedTexts. That prefix is
 * the recovery signal. Two legacy shapes are also matched: before the
 * Copy-of parser fix, unparsed files posted with the raw filename as
 * caption — "(Title) slug_..." or "Copy of (Title) slug_...".
 *
 * Safety rails:
 *  - Strong captions (normalized length ≥ 15 chars) match on prefix alone.
 *  - Weak captions (3–14 chars) must ALSO match a tight time window around
 *    the job's confirmed publish time AND be the only candidate — a one-word
 *    caption on its own is never enough evidence.
 *  - Refuses to run when another campaign shares a normalized caption
 *    (ambiguity guard) — attribution would be a coin flip.
 *  - A videoId already attributed to ANY TrackedVideo row is never stolen,
 *    and within a run each videoId is handed out at most once.
 *
 * Run rows are AnalyticsRun type "recovery"; the campaign id is stored in
 * the `cursor` column (recovery runs are one-shot, never resumed, so the
 * resumable-cursor slot is unused).
 */

import prisma from "@/lib/db";
import { ProviderError } from "./provider";
import type { AnalyticsProvider, ProviderVideo } from "./provider";
import { apifyProvider } from "./apify";
import { unresolvedPlaceholderId } from "./capture";

const TERMINAL_PUBLISHED_STATES = ["PUBLISHED", "PENDING_DELETION", "DELETED"];
const MIN_STRONG_CAPTION_LENGTH = 15;
const MIN_CAPTION_LENGTH = 3;
const WEAK_MATCH_WINDOW_MS = 30 * 60 * 1000; // ±30 min around confirmed publish
const RECOVERY_FETCH_MAX = 50;

/** Normalize a caption for comparison: lowercase, collapse whitespace, trim. */
export function normalizeCaption(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export interface LastRecoveryRun {
  startedAt: string;
  status: string;
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  error: string | null;
}

/** Latest recovery run for a campaign (null when never run). */
export async function getLastRecoveryRun(campaignId: string): Promise<LastRecoveryRun | null> {
  const run = await prisma.analyticsRun.findFirst({
    where: { type: "recovery", cursor: campaignId },
    orderBy: { startedAt: "desc" },
    select: {
      startedAt: true,
      status: true,
      attempted: true,
      succeeded: true,
      failed: true,
      skipped: true,
      error: true,
    },
  });
  if (!run) return null;
  return { ...run, startedAt: run.startedAt.toISOString() };
}

/**
 * Start a caption-match recovery for a campaign in the background.
 * Creates the AnalyticsRun row up front and returns its id immediately.
 */
export async function recoverCampaignLinks(
  campaignId: string,
  provider: AnalyticsProvider = apifyProvider
): Promise<{ runId: string }> {
  const run = await prisma.analyticsRun.create({
    data: { type: "recovery", cursor: campaignId },
  });

  (async () => {
    try {
      await runRecoveryPass(run.id, campaignId, provider);
    } catch (err: any) {
      console.error(`[Recover] Recovery pass crashed for campaign ${campaignId}:`, err?.message || err);
      await prisma.analyticsRun
        .update({
          where: { id: run.id },
          data: {
            status: "failed",
            error: err?.message || String(err),
            finishedAt: new Date(),
          },
        })
        .catch(() => {});
    }
  })();

  return { runId: run.id };
}

/**
 * The actual recovery pass. Exported (and provider-injectable) so it can be
 * driven synchronously from tests/scratch scripts. Never throws for
 * expected failure modes — they are recorded on the run row.
 */
export async function runRecoveryPass(
  runId: string,
  campaignId: string,
  provider: AnalyticsProvider = apifyProvider
): Promise<void> {
  const counters = { attempted: 0, succeeded: 0, failed: 0, skipped: 0 };
  const saveProgress = async (status?: string, error?: string) => {
    await prisma.analyticsRun.update({
      where: { id: runId },
      data: {
        ...counters,
        ...(status ? { status } : {}),
        ...(error !== undefined ? { error } : {}),
        ...(status === "done" || status === "failed" ? { finishedAt: new Date() } : {}),
      },
    });
  };

  // ── 1. Campaign + caption pool (strong ≥15 chars match on prefix alone;
  //        weak 3–14 chars need the time window + sole-candidate rule) ─────
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true, title: true, fixedTexts: true },
  });
  const allCaptions = [
    ...new Set(
      [
        ...(campaign?.fixedTexts ?? []),
        // Legacy misattribution: before the Copy-of parser fix, files whose
        // campaign bracket failed to parse posted with the RAW FILENAME as
        // caption — "(Title) slug_..." or "Copy of (Title) slug_...". Add
        // those shapes as caption prefixes so recovery can find those posts.
        ...(campaign?.title
          ? [`(${campaign.title})`, `Copy of (${campaign.title})`]
          : []),
      ]
        .map(normalizeCaption)
        .filter((c) => c.length >= MIN_CAPTION_LENGTH)
    ),
  ];
  const strongCaptions = allCaptions.filter((c) => c.length >= MIN_STRONG_CAPTION_LENGTH);
  const weakCaptions = allCaptions.filter((c) => c.length < MIN_STRONG_CAPTION_LENGTH);
  if (!campaign || allCaptions.length === 0) {
    console.warn(`[Recover] Campaign ${campaignId}: no fixed captions set — recovery skipped`);
    await saveProgress("failed", "Campaign has no fixed captions set — add at least one fixed text first");
    return;
  }

  // ── 2. Ambiguity guard: no OTHER campaign may share a normalized caption ─
  const others = await prisma.campaign.findMany({
    where: { id: { not: campaignId } },
    select: { title: true, fixedTexts: true },
  });
  const mine = new Set(allCaptions);
  for (const other of others) {
    const shared = other.fixedTexts.map(normalizeCaption).find((c) => mine.has(c));
    if (shared) {
      console.warn(
        `[Recover] Campaign ${campaignId} shares a caption with campaign '${other.title}' — aborting`
      );
      await saveProgress(
        "failed",
        `Caption is shared with campaign '${other.title}' — recovery would be ambiguous. Make the caption unique (or clear the other campaign's caption) first.`
      );
      return;
    }
  }

  // ── 3. Terminal-published jobs with no captured TrackedVideo ────────────
  const jobs = await prisma.postJob.findMany({
    where: { campaignId, state: { in: TERMINAL_PUBLISHED_STATES } },
    include: { account: { select: { tiktokUsername: true } } },
    orderBy: { publishedAt: "asc" },
  });
  const capturedRows = await prisma.trackedVideo.findMany({
    where: { postJobId: { in: jobs.map((j) => j.id) }, status: "captured" },
    select: { postJobId: true },
  });
  const capturedJobIds = new Set(capturedRows.map((r) => r.postJobId));
  const missing = jobs.filter((j) => !capturedJobIds.has(j.id));

  const byAccount = new Map<string, typeof missing>();
  for (const job of missing) {
    const list = byAccount.get(job.accountId) ?? [];
    list.push(job);
    byAccount.set(job.accountId, list);
  }

  // videoIds handed out during this run — two jobs never take the same video.
  const usedVideoIds = new Set<string>();

  // ── 4. Per-account caption matching ─────────────────────────────────────
  for (const [accountId, accountJobs] of byAccount) {
    const username = accountJobs[0].account?.tiktokUsername;
    if (!username) {
      counters.skipped += accountJobs.length;
      await saveProgress();
      continue;
    }

    let latest: ProviderVideo[];
    try {
      latest = await provider.fetchLatestVideosForAccount(username, RECOVERY_FETCH_MAX);
    } catch (err: any) {
      if (err instanceof ProviderError && (err.kind === "auth" || err.kind === "rate_limited")) {
        // Provider-wide problem — further accounts would fail the same way.
        console.error(`[Recover] Run ${runId} aborted (${err.kind}): ${err.message}`);
        await saveProgress("failed", `${err.kind}: ${err.message}`);
        return;
      }
      // Transient per-account failure: count the account's jobs failed, keep going.
      console.error(
        `[Recover] Latest-videos fetch failed for @${username} (transient): ${err?.message || err}`
      );
      counters.attempted += accountJobs.length;
      counters.failed += accountJobs.length;
      await saveProgress();
      continue;
    }

    counters.attempted += accountJobs.length;

    // Videos already attributed to ANY TrackedVideo row are untouchable.
    const taken = await prisma.trackedVideo.findMany({
      where: { tiktokVideoId: { in: latest.map((v) => v.videoId) } },
      select: { tiktokVideoId: true },
    });
    const takenIds = new Set(taken.map((t) => t.tiktokVideoId));
    const available = latest.filter(
      (v) => !takenIds.has(v.videoId) && !usedVideoIds.has(v.videoId)
    );

    for (const job of accountJobs) {
      // publishedAt may be null on legacy rows. A strong caption match needs
      // no timestamp, so only the weak tier and the unresolved placeholder
      // require it.
      const publishedMs = job.publishedAt?.getTime() ?? null;

      // Strong captions (≥15 chars) match on prefix alone. Weak captions
      // (one word etc.) must also sit within ±30 min of the confirmed
      // publish AND be the only weak candidate — otherwise we skip.
      const unused = available.filter((v) => !usedVideoIds.has(v.videoId));
      const strongMatches = unused
        .filter((v) => strongCaptions.some((c) => normalizeCaption(v.text || "").startsWith(c)))
        .sort((a, b) =>
          publishedMs == null
            ? a.createTime.getTime() - b.createTime.getTime() // no timestamp: oldest first
            : Math.abs(a.createTime.getTime() - publishedMs) -
              Math.abs(b.createTime.getTime() - publishedMs)
        );

      let match: ProviderVideo | null = null;
      let confidence = "high";
      let matchCount = 0;
      if (strongMatches.length > 0) {
        match = strongMatches[0];
        matchCount = strongMatches.length;
        confidence = strongMatches.length === 1 ? "high" : "medium";
      } else if (weakCaptions.length > 0 && publishedMs != null) {
        const weakMatches = unused
          .filter((v) => weakCaptions.some((c) => normalizeCaption(v.text || "").startsWith(c)))
          .filter((v) => Math.abs(v.createTime.getTime() - publishedMs) <= WEAK_MATCH_WINDOW_MS)
          .sort((a, b) => a.createTime.getTime() - b.createTime.getTime());
        if (weakMatches.length === 1) {
          match = weakMatches[0];
          matchCount = 1;
          confidence = "low"; // short caption + time window — visible as less certain
        }
      }

      const placeholderId = unresolvedPlaceholderId(job.id);

      if (!match) {
        if (publishedMs == null) {
          // No timestamp → only the strong tier was available; the video
          // likely scrolled past the fetch window. Nothing more to try.
          counters.skipped++;
          continue;
        }
        await prisma.trackedVideo.upsert({
          where: { tiktokVideoId: placeholderId },
          create: {
            tiktokVideoId: placeholderId,
            url: "",
            accountId: job.accountId,
            campaignId: job.campaignId,
            postJobId: job.id,
            publishedAt: job.publishedAt!, // non-null: null-publishedAt jobs are skipped above
            captureMethod: "caption_match",
            status: "unresolved",
            captureAttempts: 1,
          },
          update: {
            status: "unresolved",
            captureAttempts: { increment: 1 },
          },
        });
        console.warn(
          `[Recover] No caption match for job ${job.id} (@${username}) — marked unresolved`
        );
        counters.skipped++;
        continue;
      }

      usedVideoIds.add(match.videoId);
      const now = new Date();

      try {
        // Upsert the placeholder (or create) as captured — never insert a
        // duplicate row for a job that already has an unresolved placeholder.
        const row = await prisma.trackedVideo.upsert({
          where: { tiktokVideoId: placeholderId },
          create: {
            tiktokVideoId: match.videoId,
            url: match.url,
            accountId: job.accountId,
            campaignId: job.campaignId,
            postJobId: job.id,
            // Legacy rows may lack publishedAt — the video's real TikTok
            // createTime is the better value anyway.
            publishedAt: job.publishedAt ?? match.createTime,
            captureMethod: "caption_match",
            confidence,
            status: "captured",
            views: match.views,
            likes: match.likes,
            comments: match.comments,
            shares: match.shares,
            lastRefreshedAt: now,
          },
          update: {
            tiktokVideoId: match.videoId,
            url: match.url,
            campaignId: job.campaignId,
            captureMethod: "caption_match",
            confidence,
            status: "captured",
            views: match.views,
            likes: match.likes,
            comments: match.comments,
            shares: match.shares,
            lastRefreshedAt: now,
            captureAttempts: { increment: 1 },
          },
        });

        // Initial snapshot so per-day trend data starts at capture day.
        await prisma.videoStatSnapshot.create({
          data: {
            trackedVideoId: row.id,
            views: match.views,
            likes: match.likes,
            comments: match.comments,
            shares: match.shares,
          },
        });

        // Write the REAL video URL back to the ScheduledPost (same pattern as
        // capture.ts) so the History page links to the video.
        await prisma.scheduledPost.updateMany({
          where: {
            accountId: job.accountId,
            OR: [
              { tiktokPublishId: job.tiktokPublishId ?? undefined },
              { driveFileId: job.driveFileId },
            ],
          },
          data: { tiktokPostUrl: match.url },
        });

        console.log(
          `[Recover] Job ${job.id} → video ${match.videoId} (confidence ${confidence}, ${matchCount} caption match(es))`
        );
        counters.succeeded++;
      } catch (err: any) {
        console.error(`[Recover] Failed to persist capture for job ${job.id}:`, err?.message || err);
        counters.failed++;
      }
    }

    await saveProgress();
  }

  await saveProgress("done");
  console.log(
    `[Recover] Run ${runId} done: attempted=${counters.attempted} succeeded=${counters.succeeded} failed=${counters.failed} skipped=${counters.skipped}`
  );
}
