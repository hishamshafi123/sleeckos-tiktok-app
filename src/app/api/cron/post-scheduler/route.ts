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

function matchesAnySlot(
  slots: string[],
  currentMinutes: number
): string | null {
  for (const slot of slots) {
    const slotMinutes = parseSlot(slot);
    if (Math.abs(currentMinutes - slotMinutes) <= 5) return slot;
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

      const matchedSlot = matchesAnySlot(slots, currentMinutes);
      if (!matchedSlot) {
        results[accountKey] = `not_scheduled_time`;
        continue;
      }

      // Check slot already posted
      const todayStart = new Date(
        zonedNow.getFullYear(),
        zonedNow.getMonth(),
        zonedNow.getDate()
      );
      const slotMinutes = parseSlot(matchedSlot);
      const slotWindowStart = new Date(todayStart);
      slotWindowStart.setMinutes(slotMinutes - 10);
      const slotWindowEnd = new Date(todayStart);
      slotWindowEnd.setMinutes(slotMinutes + 10);

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
        files = await listVideoFilesInFolder(account.driveFolderId!);
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

      // ── Caption ──────────────────────────────────────────────────────────
      let caption = "";
      if (account.captionSource === "FILENAME") {
        caption = nextFile.name!.replace(/\.[^.]+$/, "");
      } else if (account.captionSource === "DEFAULT") {
        caption = account.defaultCaption || "";
      }

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
        await makeFilePublic(nextFile.id);
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

        await prisma.scheduledPost.update({
          where: { id: post.id },
          data: {
            tiktokPublishId: result.postId || null,
            status: "PUBLISHED",
            publishedAt: new Date(),
          },
        });

        // Delete from Drive after successful post
        try {
          await deleteDriveFile(nextFile.id);
        } catch (delErr) {
          console.error(`Drive delete failed for ${nextFile.id}:`, delErr);
        }

        results[accountKey] = `published via PostPeer (slot ${matchedSlot})`;
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
