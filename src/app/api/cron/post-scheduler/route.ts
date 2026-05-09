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

  for (const account of accounts) {
    const accountKey = `@${account.tiktokUsername}`;
    try {
      // Convert now to account's timezone
      const zonedNow = toZonedTime(now, account.postTimezone);
      const currentHour = zonedNow.getHours();
      const currentMinute = zonedNow.getMinutes();
      const currentDay = dayNumber(zonedNow);

      // Check if it's within the post window (±5 min of scheduled time)
      const isRightDay = account.postDays.split(",").includes(currentDay);
      const scheduledMinutes =
        account.postTimeHour * 60 + account.postTimeMinute;
      const currentMinutes = currentHour * 60 + currentMinute;
      const isRightTime = Math.abs(currentMinutes - scheduledMinutes) <= 5;

      if (!isRightDay || !isRightTime) {
        results[accountKey] = "not_scheduled";
        continue;
      }

      // Check if we already posted today for this account
      const todayStart = new Date(
        zonedNow.getFullYear(),
        zonedNow.getMonth(),
        zonedNow.getDate()
      );
      const postedToday = await prisma.scheduledPost.count({
        where: {
          accountId: account.id,
          scheduledFor: { gte: todayStart },
          status: { in: ["PUBLISHED", "UPLOADING", "PROCESSING", "QUEUED"] },
        },
      });

      if (postedToday > 0) {
        results[accountKey] = "already_posted_today";
        continue;
      }

      // Refresh token if needed (expires in < 1 hour)
      let accessToken = account.tiktokAccessToken;
      if (account.tokenExpiresAt.getTime() - Date.now() < 3600_000) {
        const refreshed = await refreshTikTokToken(account.tiktokRefreshToken);
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
        }
      }

      // List Drive files and find the next unposted one
      const files = await listVideoFilesInFolder(account.driveFolderId!);
      if (!files.length) {
        await prisma.scheduledPost.create({
          data: {
            accountId: account.id,
            scheduledFor: now,
            status: "SKIPPED",
            errorMessage: "No video files in Drive folder",
          },
        });
        results[accountKey] = "skipped_no_files";
        continue;
      }

      // Get IDs of already-posted files
      const postedFileIds = await prisma.scheduledPost
        .findMany({
          where: { accountId: account.id, driveFileId: { not: null } },
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
            errorMessage: "All files in Drive folder have been posted",
          },
        });
        results[accountKey] = "skipped_all_posted";
        continue;
      }

      // Resolve caption
      let caption = "";
      if (account.captionSource === "FILENAME") {
        caption = nextFile.name!.replace(/\.[^.]+$/, ""); // strip extension
      } else if (account.captionSource === "DEFAULT") {
        caption = account.defaultCaption || "";
      }
      // TXT_FILE source would look for nextFile.name + ".txt" — simplified here

      // Create the post record
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

      // Download from Drive
      let videoBuffer: Buffer;
      try {
        videoBuffer = await downloadDriveFile(nextFile.id);
      } catch (err) {
        await prisma.scheduledPost.update({
          where: { id: post.id },
          data: {
            status: "FAILED",
            errorMessage: `Drive download failed: ${err instanceof Error ? err.message : err}`,
          },
        });
        results[accountKey] = "failed_download";
        continue;
      }

      // Update status to UPLOADING
      await prisma.scheduledPost.update({
        where: { id: post.id },
        data: { status: "UPLOADING" },
      });

      // Post to TikTok
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
            errorMessage: `TikTok upload failed: ${err instanceof Error ? err.message : err}`,
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

      results[accountKey] = `processing:${publishId}`;
    } catch (err) {
      results[accountKey] = `error: ${err instanceof Error ? err.message : err}`;
    }
  }

  return NextResponse.json({ ok: true, processed: accounts.length, results });
}
