export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { listVideoFilesInFolder, downloadDriveFile } from "@/lib/google";
import { postVideoToTikTok, refreshTikTokToken } from "@/lib/tiktok-managed";
import { toZonedTime } from "date-fns-tz";

function verifyCronSecret(req: NextRequest) {
  const secret =
    req.headers.get("x-cron-secret") ||
    req.nextUrl.searchParams.get("secret");
  return secret === process.env.CRON_SECRET;
}

// Day-of-week: 1=Mon..7=Sun → matching postDays CSV format
function dayNumber(date: Date): string {
  const d = date.getDay(); // 0=Sun..6=Sat
  return d === 0 ? "7" : d.toString();
}

/** Parse "HH:MM" → total minutes */
function parseSlot(slot: string): number {
  const [h, m] = slot.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Check if current time is within ±5 min of ANY slot */
function matchesAnySlot(
  slots: string[],
  currentMinutes: number
): string | null {
  for (const slot of slots) {
    const slotMinutes = parseSlot(slot);
    if (Math.abs(currentMinutes - slotMinutes) <= 5) {
      return slot;
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

  // Fetch all active accounts with a linked Drive folder
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
      // Convert now to account's timezone
      const zonedNow = toZonedTime(now, account.postTimezone);
      const currentHour = zonedNow.getHours();
      const currentMinute = zonedNow.getMinutes();
      const currentMinutes = currentHour * 60 + currentMinute;
      const currentDay = dayNumber(zonedNow);

      // Check day
      const isRightDay = account.postDays.split(",").includes(currentDay);
      if (!isRightDay) {
        results[accountKey] = "not_scheduled_day";
        continue;
      }

      // Parse time slots — use postTimeSlots if set, else fall back to legacy fields
      const rawSlots = account.postTimeSlots || "";
      const slots =
        rawSlots.trim().length > 0
          ? rawSlots.split(",").map((s) => s.trim())
          : [
              `${account.postTimeHour.toString().padStart(2, "0")}:${account.postTimeMinute.toString().padStart(2, "0")}`,
            ];

      // Check if current time matches any slot
      const matchedSlot = matchesAnySlot(slots, currentMinutes);
      if (!matchedSlot) {
        results[accountKey] = `not_scheduled_time (slots: ${slots.join(", ")})`;
        continue;
      }

      // Check if we already posted for this specific slot today
      const todayStart = new Date(
        zonedNow.getFullYear(),
        zonedNow.getMonth(),
        zonedNow.getDate()
      );
      // Count how many posts already exist today for this account
      const postsToday = await prisma.scheduledPost.count({
        where: {
          accountId: account.id,
          scheduledFor: { gte: todayStart },
          status: {
            in: ["PUBLISHED", "UPLOADING", "PROCESSING", "QUEUED", "DOWNLOADING"],
          },
        },
      });

      // Find which slot index we're on — allow up to slots.length posts per day
      if (postsToday >= slots.length) {
        results[accountKey] = `all_slots_filled (${postsToday}/${slots.length})`;
        continue;
      }

      // Check we haven't already posted for this specific slot (±10 min window)
      const slotMinutes = parseSlot(matchedSlot);
      const slotWindowStart = new Date(todayStart);
      slotWindowStart.setMinutes(slotMinutes - 10);
      const slotWindowEnd = new Date(todayStart);
      slotWindowEnd.setMinutes(slotMinutes + 10);

      const postedForSlot = await prisma.scheduledPost.count({
        where: {
          accountId: account.id,
          scheduledFor: { gte: slotWindowStart, lte: slotWindowEnd },
          status: {
            in: ["PUBLISHED", "UPLOADING", "PROCESSING", "QUEUED", "DOWNLOADING"],
          },
        },
      });

      if (postedForSlot > 0) {
        results[accountKey] = `slot_${matchedSlot}_already_posted`;
        continue;
      }

      // ── Token refresh ────────────────────────────────────────────────────────
      let accessToken = account.tiktokAccessToken;
      if (account.tokenExpiresAt.getTime() - Date.now() < 3600_000) {
        try {
          const refreshed = await refreshTikTokToken(
            account.tiktokRefreshToken
          );
          if (refreshed.access_token) {
            accessToken = refreshed.access_token;
            await prisma.managedAccount.update({
              where: { id: account.id },
              data: {
                tiktokAccessToken: refreshed.access_token,
                tiktokRefreshToken:
                  refreshed.refresh_token || account.tiktokRefreshToken,
                tokenExpiresAt: new Date(
                  Date.now() + (refreshed.expires_in ?? 86400) * 1000
                ),
                refreshTokenExpiresAt: new Date(
                  Date.now() +
                    (refreshed.refresh_expires_in ?? 86400 * 30) * 1000
                ),
              },
            });
          } else {
            await prisma.scheduledPost.create({
              data: {
                accountId: account.id,
                scheduledFor: now,
                status: "FAILED",
                errorMessage: `Token refresh failed: ${JSON.stringify(refreshed.error || refreshed)}. Re-authenticate this account.`,
              },
            });
            results[accountKey] = "failed_token_refresh";
            continue;
          }
        } catch (err) {
          await prisma.scheduledPost.create({
            data: {
              accountId: account.id,
              scheduledFor: now,
              status: "FAILED",
              errorMessage: `Token refresh error: ${err instanceof Error ? err.message : String(err)}`,
            },
          });
          results[accountKey] = "error_token_refresh";
          continue;
        }
      }

      // ── Drive files ──────────────────────────────────────────────────────────
      let files;
      try {
        files = await listVideoFilesInFolder(account.driveFolderId!);
      } catch (err) {
        await prisma.scheduledPost.create({
          data: {
            accountId: account.id,
            scheduledFor: now,
            status: "FAILED",
            errorMessage: `Could not list Drive folder: ${err instanceof Error ? err.message : String(err)}. Check that the folder is shared with the service account.`,
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
            errorMessage:
              "No video files found in the linked Drive folder. Upload videos to the folder.",
          },
        });
        results[accountKey] = "skipped_no_files";
        continue;
      }

      // Get IDs of already-posted files
      const postedFileIds = await prisma.scheduledPost
        .findMany({
          where: {
            accountId: account.id,
            driveFileId: { not: null },
            status: { not: "FAILED" },
          },
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
            errorMessage: `All ${files.length} video(s) in the Drive folder have already been posted. Add more videos to continue.`,
          },
        });
        results[accountKey] = "skipped_all_posted";
        continue;
      }

      // ── Resolve caption ──────────────────────────────────────────────────────
      let caption = "";
      if (account.captionSource === "FILENAME") {
        caption = nextFile.name!.replace(/\.[^.]+$/, ""); // strip extension
      } else if (account.captionSource === "DEFAULT") {
        caption = account.defaultCaption || "";
      }

      // ── Create post record ───────────────────────────────────────────────────
      const post = await prisma.scheduledPost.create({
        data: {
          accountId: account.id,
          driveFileId: nextFile.id,
          driveFileName: nextFile.name,
          caption,
          scheduledFor: now,
          status: "DOWNLOADING",
        },
      });

      // ── Download from Drive ──────────────────────────────────────────────────
      let videoBuffer: Buffer;
      try {
        videoBuffer = await downloadDriveFile(nextFile.id);
      } catch (err) {
        await prisma.scheduledPost.update({
          where: { id: post.id },
          data: {
            status: "FAILED",
            errorMessage: `Drive download failed for "${nextFile.name}": ${err instanceof Error ? err.message : String(err)}`,
          },
        });
        results[accountKey] = "failed_download";
        continue;
      }

      // ── Upload to TikTok ─────────────────────────────────────────────────────
      await prisma.scheduledPost.update({
        where: { id: post.id },
        data: { status: "UPLOADING" },
      });

      let publishId: string;
      try {
        const result = await postVideoToTikTok(
          accessToken,
          videoBuffer,
          caption,
          account.postMode as "DIRECT" | "DRAFT"
        );
        publishId = result.publishId;
      } catch (err) {
        await prisma.scheduledPost.update({
          where: { id: post.id },
          data: {
            status: "FAILED",
            errorMessage: `TikTok upload failed for "${nextFile.name}": ${err instanceof Error ? err.message : String(err)}`,
          },
        });
        results[accountKey] = "failed_upload";
        continue;
      }

      // Mark as processing
      await prisma.scheduledPost.update({
        where: { id: post.id },
        data: { tiktokPublishId: publishId, status: "PROCESSING" },
      });

      results[accountKey] = `processing:${publishId} (slot ${matchedSlot})`;
    } catch (err) {
      results[accountKey] = `error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  return NextResponse.json({ ok: true, processed: accounts.length, results });
}
