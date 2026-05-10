export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { listVideoFilesInFolder, downloadDriveFile, deleteDriveFile } from "@/lib/google";
import { postVideoToTikTok, refreshTikTokToken } from "@/lib/tiktok-managed";

// POST /api/managed/accounts/[id]/post-now — instantly post next Drive video
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const account = await prisma.managedAccount.findUnique({ where: { id } });

  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }
  if (!account.driveConnected || !account.driveFolderId) {
    return NextResponse.json(
      { error: "No Google Drive folder linked. Link a folder first in Settings." },
      { status: 400 }
    );
  }

  // ── Token refresh ──────────────────────────────────────────────────────────
  let accessToken = account.tiktokAccessToken;
  if (account.tokenExpiresAt.getTime() - Date.now() < 3600_000) {
    try {
      const refreshed = await refreshTikTokToken(account.tiktokRefreshToken);
      if (!refreshed.access_token) {
        return NextResponse.json(
          { error: `Token expired. Re-authenticate @${account.tiktokUsername} via TikTok Login.` },
          { status: 400 }
        );
      }
      accessToken = refreshed.access_token;
      await prisma.managedAccount.update({
        where: { id },
        data: {
          tiktokAccessToken: refreshed.access_token,
          tiktokRefreshToken: refreshed.refresh_token || account.tiktokRefreshToken,
          tokenExpiresAt: new Date(Date.now() + (refreshed.expires_in ?? 86400) * 1000),
          refreshTokenExpiresAt: new Date(Date.now() + (refreshed.refresh_expires_in ?? 86400 * 30) * 1000),
        },
      });
    } catch (err) {
      return NextResponse.json(
        { error: `Token refresh error: ${err instanceof Error ? err.message : String(err)}` },
        { status: 500 }
      );
    }
  }

  // ── Find next unposted file ────────────────────────────────────────────────
  let files;
  try {
    files = await listVideoFilesInFolder(account.driveFolderId);
  } catch (err) {
    return NextResponse.json(
      { error: `Cannot access Drive folder: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }

  if (!files.length) {
    return NextResponse.json(
      { error: "No video files in the linked Drive folder." },
      { status: 400 }
    );
  }

  const postedFileIds = await prisma.scheduledPost
    .findMany({
      where: { accountId: id, driveFileId: { not: null }, status: { not: "FAILED" } },
      select: { driveFileId: true },
    })
    .then((rows) => new Set(rows.map((r) => r.driveFileId)));

  const nextFile = files.find((f) => f.id && !postedFileIds.has(f.id));
  if (!nextFile || !nextFile.id) {
    return NextResponse.json(
      { error: `All ${files.length} video(s) have been posted. Add more to the Drive folder.` },
      { status: 400 }
    );
  }

  // ── Caption ────────────────────────────────────────────────────────────────
  let caption = "";
  if (account.captionSource === "FILENAME") {
    caption = nextFile.name!.replace(/\.[^.]+$/, "");
  } else if (account.captionSource === "DEFAULT") {
    caption = account.defaultCaption || "";
  }

  // ── Create post record ─────────────────────────────────────────────────────
  const post = await prisma.scheduledPost.create({
    data: {
      accountId: id,
      driveFileId: nextFile.id,
      driveFileName: nextFile.name,
      caption,
      scheduledFor: new Date(),
      status: "DOWNLOADING",
    },
  });

  // ── Download + Upload (fire-and-forget, tracked via status) ────────────────
  const driveFileId = nextFile.id;
  (async () => {
    try {
      const videoBuffer = await downloadDriveFile(driveFileId);

      await prisma.scheduledPost.update({
        where: { id: post.id },
        data: { status: "UPLOADING" },
      });

      const { publishId } = await postVideoToTikTok(
        accessToken,
        videoBuffer,
        caption,
        account.postMode as "DIRECT" | "DRAFT"
      );

      await prisma.scheduledPost.update({
        where: { id: post.id },
        data: { tiktokPublishId: publishId, status: "PROCESSING" },
      });

      // Delete from Drive after successful upload
      try {
        await deleteDriveFile(driveFileId);
      } catch (delErr) {
        console.error(`Post succeeded but Drive delete failed for ${driveFileId}:`, delErr);
      }
    } catch (err) {
      await prisma.scheduledPost.update({
        where: { id: post.id },
        data: {
          status: "FAILED",
          errorMessage: `Post Now failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      });
    }
  })();

  return NextResponse.json({
    ok: true,
    postId: post.id,
    fileName: nextFile.name,
    message: `Posting "${nextFile.name}" now...`,
  });
}
