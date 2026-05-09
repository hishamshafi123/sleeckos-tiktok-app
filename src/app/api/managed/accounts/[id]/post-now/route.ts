export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { downloadDriveFile } from "@/lib/google";
import { postVideoToTikTok, refreshTikTokToken } from "@/lib/tiktok-managed";

// POST /api/managed/accounts/[id]/post-now — immediately post next Drive video
export async function POST(
  req: NextRequest,
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
      { error: "No Drive folder linked" },
      { status: 400 }
    );
  }

  // Optionally accept a specific driveFileId from body
  const body = await req.json().catch(() => ({}));
  const { driveFileId, driveFileName, caption } = body as {
    driveFileId?: string;
    driveFileName?: string;
    caption?: string;
  };

  if (!driveFileId) {
    return NextResponse.json(
      { error: "driveFileId is required in request body" },
      { status: 400 }
    );
  }

  // Refresh token if needed
  let accessToken = account.tiktokAccessToken;
  if (account.tokenExpiresAt.getTime() - Date.now() < 3600_000) {
    const refreshed = await refreshTikTokToken(account.tiktokRefreshToken);
    if (refreshed.access_token) {
      accessToken = refreshed.access_token;
      await prisma.managedAccount.update({
        where: { id },
        data: {
          tiktokAccessToken: refreshed.access_token,
          tiktokRefreshToken:
            refreshed.refresh_token || account.tiktokRefreshToken,
          tokenExpiresAt: new Date(
            Date.now() + (refreshed.expires_in ?? 86400) * 1000
          ),
        },
      });
    }
  }

  const finalCaption =
    caption ||
    (account.captionSource === "FILENAME" && driveFileName
      ? driveFileName.replace(/\.[^.]+$/, "")
      : account.defaultCaption || "");

  // Create post record
  const post = await prisma.scheduledPost.create({
    data: {
      accountId: id,
      driveFileId,
      driveFileName: driveFileName || null,
      caption: finalCaption,
      scheduledFor: new Date(),
      status: "DOWNLOADING",
    },
  });

  // Download + upload async (fire and forget — status tracked via poll-status)
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
        finalCaption,
        account.postMode as "DIRECT" | "DRAFT"
      );

      await prisma.scheduledPost.update({
        where: { id: post.id },
        data: { tiktokPublishId: publishId, status: "PROCESSING" },
      });
    } catch (err) {
      await prisma.scheduledPost.update({
        where: { id: post.id },
        data: {
          status: "FAILED",
          errorMessage:
            err instanceof Error ? err.message : "Unknown error",
        },
      });
    }
  })();

  return NextResponse.json({ ok: true, postId: post.id });
}
