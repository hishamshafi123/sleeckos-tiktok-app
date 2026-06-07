export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import {
  listVideoFilesInFolder,
  makeFilePublic,
  deleteDriveFile,
} from "@/lib/google";
import { postViaPostPeer, driveDirectUrl } from "@/lib/postpeer";
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

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const results: Record<string, string> = {};

  const accounts = await prisma.managedAccount.findMany({
    where: { isActive: true, driveConnected: true },
    include: {
      group: {
        include: {
          section: true,
        },
      },
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

      // Check section and group active status (hierarchical toggle)
      if (!account.group.section.isActive) {
        results[accountKey] = "skipped_section_disabled";
        continue;
      }
      if (!account.group.isActive) {
        results[accountKey] = "skipped_group_disabled";
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
          status: { in: ["PUBLISHED", "UPLOADING", "PROCESSING", "QUEUED", "DOWNLOADING"] },
        },
      });

      if (postedForSlot > 0) {
        results[accountKey] = `slot_${matchedSlot}_already_posted`;
        continue;
      }

      // ── Get next unposted file from Drive ────────────────────────────────
      let files;
      try {
        files = await listVideoFilesInFolder(account.driveFolderId!, account.id);
      } catch (err) {
        await prisma.scheduledPost.create({
          data: {
            accountId: account.id,
            scheduledFor: now,
            status: "FAILED",
            errorMessage: `Drive folder access failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        });
        results[accountKey] = "failed_drive_access";
        continue;
      }

      if (!files.length) {
        await prisma.scheduledPost.create({
          data: {
            accountId: account.id,
            scheduledFor: now,
            status: "SKIPPED",
            errorMessage: "No video files in Drive folder.",
          },
        });
        results[accountKey] = "skipped_no_files";
        continue;
      }

      const postedFileIds = await prisma.scheduledPost
        .findMany({
          where: { accountId: account.id, driveFileId: { not: null }, status: { not: "FAILED" } },
          select: { driveFileId: true },
        })
        .then((rows) => new Set(rows.map((r) => r.driveFileId)));

      const nextFile = files.find((f) => f.id && !postedFileIds.has(f.id));
      if (!nextFile || !nextFile.id) {
        await prisma.scheduledPost.create({
          data: {
            accountId: account.id,
            scheduledFor: now,
            status: "SKIPPED",
            errorMessage: `All ${files.length} video(s) have been posted. Add more to Drive.`,
          },
        });
        results[accountKey] = "skipped_all_posted";
        continue;
      }

      // ── Caption (section is STRONGEST, then group, then account) ──────
      // Section-level description overrides everything.
      let caption = "";
      const sec = account.group.section;

      console.log(`[PostScheduler] Caption build for ${accountKey}: captionSource=${account.captionSource}, section.descTags=${sec.descTags ? `"${sec.descTags}"` : "null"}, section.descTagCount=${sec.descTagCount}, section.descFixedText=${sec.descFixedText ? `"${sec.descFixedText}"` : "null"}, section.descFixedTextEnabled=${sec.descFixedTextEnabled}`);

      // 1. Base text — section config takes full control when present
      const sectionHasConfig = (sec.descFixedTextEnabled && sec.descFixedText?.trim()) || (sec.descTags && sec.descTagCount > 0);

      if (sectionHasConfig) {
        // Section owns the description — use fixed text if set, otherwise just tags (added below)
        if (sec.descFixedTextEnabled && sec.descFixedText?.trim()) {
          caption = sec.descFixedText.trim();
        }
        // No fallback to account/group — tags will be appended in step 2
      } else if (account.captionSource === "FILENAME") {
        caption = nextFile.name!.replace(/\.[^.]+$/, "");
      } else if (account.captionSource === "DEFAULT") {
        // Fallback only when section has NO config at all
        if (account.group.defaultDescription) {
          caption = account.group.defaultDescription;
        } else if (account.defaultCaption) {
          caption = account.defaultCaption;
        }
      }

      // 2. Always append section random tags
      if (sec.descTags && sec.descTagCount > 0) {
        const allTags = sec.descTags
          .split(",")
          .map((t: string) => t.trim())
          .filter((t: string) => t.length > 0);
        if (allTags.length > 0) {
          const shuffled = [...allTags].sort(() => Math.random() - 0.5);
          const picked = shuffled.slice(0, Math.min(sec.descTagCount, allTags.length));
          const tagLine = picked.join(" ");
          caption = caption ? `${caption}\n\n${tagLine}` : tagLine;
        }
      }

      console.log(`[PostScheduler] Final caption for ${accountKey}: "${caption.substring(0, 200)}"`);

      // ── Create post record ───────────────────────────────────────────────
      const post = await prisma.scheduledPost.create({
        data: {
          accountId: account.id,
          driveFileId: nextFile.id,
          driveFileName: nextFile.name,
          caption,
          scheduledFor: now,
          status: "UPLOADING",
        },
      });

      // ── Make file public, post via PostPeer, cleanup ─────────────────────
      try {
        await makeFilePublic(nextFile.id, account.id);
        const videoUrl = driveDirectUrl(nextFile.id);

        const result = await postViaPostPeer(
          account.postpeerAccountId,
          caption,
          videoUrl,
          {
            draft: account.postMode === "DRAFT",
            privacyLevel: "PUBLIC_TO_EVERYONE",
            disableComment: false,
            disableDuet: false,
            disableStitch: false,
            publishNow: true,
          }
        );

        // The initial POST response does NOT contain the actual TikTok video URL.
        // platformPostId from POST is TikTok's publish_id, NOT the video_id.
        // platformPostUrl may be populated if PostPeer provides it directly.
        const tiktokPostUrl = result.platformPostUrl || null;

        console.log(`[PostScheduler] PostPeer result for ${accountKey}: postId=${result.postId}, platformPostUrl=${tiktokPostUrl}`);

        await prisma.scheduledPost.update({
          where: { id: post.id },
          data: {
            tiktokPublishId: result.postId || null,
            tiktokPostUrl,
            status: "PUBLISHED",
            publishedAt: new Date(),
          },
        });

        // Delete from Drive after successful post
        try {
          await deleteDriveFile(nextFile.id, account.id);
        } catch (delErr) {
          console.error(`Drive delete failed for ${nextFile.id}:`, delErr);
        }

        const jitterSign = jitter >= 0 ? `+${jitter}` : `${jitter}`;
        const jitterHour = Math.floor(jitteredMinutes / 60);
        const jitterMin = jitteredMinutes % 60;
        const jitteredTimeStr = `${jitterHour.toString().padStart(2, "0")}:${jitterMin.toString().padStart(2, "0")}`;
        results[accountKey] = `published via PostPeer (slot ${matchedSlot}, jittered ${jitterSign}m to ${jitteredTimeStr})`;
      } catch (err) {
        await prisma.scheduledPost.update({
          where: { id: post.id },
          data: {
            status: "FAILED",
            errorMessage: `PostPeer post failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        });
        results[accountKey] = "failed_postpeer";
      }
    } catch (err) {
      results[accountKey] = `error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  return NextResponse.json({ ok: true, processed: accounts.length, results });
}
