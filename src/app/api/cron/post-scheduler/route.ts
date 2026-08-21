export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import {
  ingestDriveFiles,
  claimNextVideo,
  uploadAndPublish,
  buildPostCaption,
  resolveCampaignCaptionConfig,
} from "@/lib/services/posting-pipeline";
import { resumeSmartExportQueue } from "@/lib/services/multiplier-export";
import { resumeRenderQueueIfWorkPending } from "@/lib/services/multiplier";
import { toZonedTime } from "date-fns-tz";

function verifyCronSecret(req: NextRequest) {
  const secret =
    req.headers.get("x-cron-secret") ||
    req.nextUrl.searchParams.get("secret");
  return secret === process.env.CRON_SECRET;
}

function dayNumber(date: Date): string {
  const d = date.getDay();
  return d === 0 ? "7" : d.toString();
}

function parseSlot(slot: string): number {
  const [h, m] = slot.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function getDeterministicJitter(accountId: string, slot: string, dateStr: string): number {
  const seedStr = `${accountId}-${slot}-${dateStr}`;
  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    const char = seedStr.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  const val = Math.abs(hash) % 61; // 0 to 60
  return val - 30; // -30 to +30
}

function matchesAnySlotWithJitter(
  slots: string[],
  currentMinutes: number,
  accountId: string,
  dateStr: string
): { slot: string; jitteredMinutes: number; jitter: number } | null {
  for (const slot of slots) {
    const slotMinutes = parseSlot(slot);
    const jitter = getDeterministicJitter(accountId, slot, dateStr);
    const jitteredMinutes = slotMinutes + jitter;
    if (Math.abs(currentMinutes - jitteredMinutes) <= 5) {
      return { slot, jitteredMinutes, jitter };
    }
  }
  return null;
}

// Single app container — a module-level lock is sufficient to prevent
// overlapping cron runs (a full run can exceed the 5-min cron interval).
let isRunning = false;

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Safety net for restart/crash-stranded background queues (their worker
  // loops are in-memory). Fire-and-forget, cheap indexed queries — runs every
  // 5 min with this cron, so a mid-day crash self-heals within minutes.
  resumeSmartExportQueue().catch((err) =>
    console.error("[PostScheduler] Smart Export queue resume failed:", err)
  );
  resumeRenderQueueIfWorkPending().catch((err) =>
    console.error("[PostScheduler] Render queue resume failed:", err)
  );

  if (isRunning) {
    return NextResponse.json({ skipped: "already running" });
  }

  isRunning = true;
  try {
    return await runScheduler();
  } finally {
    isRunning = false;
  }
}

async function runScheduler() {
  const now = new Date();
  const results: Record<string, string> = {};

  const accounts = await prisma.managedAccount.findMany({
    where: { isActive: true, driveConnected: true },
    include: {
      section: true,
    },
  });

  if (accounts.length === 0) {
    return NextResponse.json({
      ok: true,
      processed: 0,
      results: { _info: "No active accounts with Drive folders linked" },
    });
  }

  for (const account of accounts) {
    const accountKey = `@${account.tiktokUsername}`;
    try {
      // Check PostPeer account ID
      if (!account.postpeerAccountId) {
        results[accountKey] = "skipped_no_postpeer_id";
        continue;
      }

      // Check account health
      if (account.connectionState !== "healthy") {
        results[accountKey] = `skipped_unhealthy_${account.connectionState}`;
        continue;
      }

      // Check section active status (hierarchical toggle)
      if (!account.section.isActive) {
        results[accountKey] = "skipped_section_disabled";
        continue;
      }

      const zonedNow = toZonedTime(now, account.postTimezone);
      const currentMinutes = zonedNow.getHours() * 60 + zonedNow.getMinutes();
      const currentDay = dayNumber(zonedNow);

      if (!account.postDays.split(",").includes(currentDay)) {
        results[accountKey] = "not_scheduled_day";
        continue;
      }

      const rawSlots = account.postTimeSlots || "";
      const slots =
        rawSlots.trim().length > 0
          ? rawSlots.split(",").map((s) => s.trim())
          : [
              `${account.postTimeHour.toString().padStart(2, "0")}:${account.postTimeMinute.toString().padStart(2, "0")}`,
            ];

      const year = zonedNow.getFullYear();
      const month = String(zonedNow.getMonth() + 1).padStart(2, "0");
      const day = String(zonedNow.getDate()).padStart(2, "0");
      const dateStr = `${year}-${month}-${day}`;

      const matched = matchesAnySlotWithJitter(slots, currentMinutes, account.id, dateStr);
      if (!matched) {
        results[accountKey] = `not_scheduled_time`;
        continue;
      }

      const { slot: matchedSlot, jitteredMinutes, jitter } = matched;

      // Check slot already posted
      const todayStart = new Date(
        zonedNow.getFullYear(),
        zonedNow.getMonth(),
        zonedNow.getDate()
      );
      const slotMinutes = parseSlot(matchedSlot);
      const slotWindowStart = new Date(todayStart);
      slotWindowStart.setMinutes(jitteredMinutes - 10);
      const slotWindowEnd = new Date(todayStart);
      slotWindowEnd.setMinutes(jitteredMinutes + 10);

      const postedForSlot = await prisma.scheduledPost.count({
        where: {
          accountId: account.id,
          scheduledFor: { gte: slotWindowStart, lte: slotWindowEnd },
          status: { in: ["PUBLISHED", "UPLOADING", "PROCESSING", "QUEUED", "DOWNLOADING", "CLAIMED"] },
        },
      });

      if (postedForSlot > 0) {
        results[accountKey] = `slot_${matchedSlot}_already_posted`;
        continue;
      }

      // Hard guard: never post twice within 15 min for the same account.
      // Multiple cron ticks can match one slot (±5 min window at 5-min
      // cadence). Keyed on PostJob ACTIVITY (lockedAt is set at claim time,
      // publishedAt at confirmation) — NOT on ScheduledPost.createdAt, which
      // reflects ingestion time and goes blind for pre-ingested files.
      const fifteenMinAgo = new Date(now.getTime() - 15 * 60 * 1000);
      const recentPost = await prisma.postJob.count({
        where: {
          accountId: account.id,
          OR: [
            { lockedAt: { gte: fifteenMinAgo } },
            { publishedAt: { gte: fifteenMinAgo } },
          ],
        },
      });

      if (recentPost > 0) {
        results[accountKey] = "skipped_recent_post_within_15m";
        continue;
      }

      // Minimum 3-hour gap between posts per account (automated pipeline only —
      // the manual "Post Now" button in Managed Accounts overrides this).
      // No back-to-back posting: anything published or in-flight within the
      // last 3 hours blocks the next automated post. Keyed on PostJob
      // publishedAt / updatedAt (activity), not row creation time.
      const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);
      const activityWithinGap = await prisma.postJob.findFirst({
        where: {
          accountId: account.id,
          OR: [
            { publishedAt: { gte: threeHoursAgo } },
            {
              state: { in: ["CLAIMED", "UPLOADING", "PENDING_DELETION"] },
              updatedAt: { gte: threeHoursAgo },
            },
          ],
        },
        select: { id: true, publishedAt: true },
      });

      if (activityWithinGap) {
        results[accountKey] = "skipped_min_gap_3h";
        continue;
      }

      // ── Ingest Drive files & Claim next unposted file atomically ─────────
      try {
        await ingestDriveFiles(account.id);
      } catch (ingestErr) {
        console.error(`Ingest failed for ${accountKey}:`, ingestErr);
      }

      const job = await claimNextVideo(account.id, `cron-worker-${process.pid || "default"}`);
      if (!job) {
        results[accountKey] = "skipped_no_available_files";
        continue;
      }

      // ── Caption (campaign fixedTexts pool is STRONGEST, then filename) ──
      const campaignConfig = await resolveCampaignCaptionConfig(job.campaignId);
      const sec = account.section;

      console.log(`[PostScheduler] Caption build for ${accountKey}: campaign.fixedTexts=${campaignConfig?.fixedTexts.length ?? 0} entries, campaign.descTags=${campaignConfig?.descTags ? `"${campaignConfig.descTags}"` : "null"}, section.descTags=${sec.descTags ? `"${sec.descTags}"` : "null"}, section.descTagCount=${sec.descTagCount}`);

      const caption = buildPostCaption(account, job, campaignConfig);

      console.log(`[PostScheduler] Final caption for ${accountKey}: "${caption.substring(0, 200)}"`);

      // ── Upload via PostPeer (no immediate Drive delete) ───────────────────
      try {
        await uploadAndPublish(job.id, caption);

        const jitterSign = jitter >= 0 ? `+${jitter}` : `${jitter}`;
        const jitterHour = Math.floor(jitteredMinutes / 60);
        const jitterMin = jitteredMinutes % 60;
        const jitteredTimeStr = `${jitterHour.toString().padStart(2, "0")}:${jitterMin.toString().padStart(2, "0")}`;
        results[accountKey] = `upload_started (slot ${matchedSlot}, jittered ${jitterSign}m to ${jitteredTimeStr})`;
      } catch (err) {
        results[accountKey] = `upload_failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    } catch (err) {
      results[accountKey] = `error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  return NextResponse.json({ ok: true, processed: accounts.length, results });
}
