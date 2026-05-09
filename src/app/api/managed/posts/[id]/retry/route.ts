export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { downloadDriveFile } from "@/lib/google";
import { postVideoToTikTok, refreshTikTokToken } from "@/lib/tiktok-managed";

// POST /api/managed/posts/[id]/retry — retry a FAILED post
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const post = await prisma.scheduledPost.findUnique({
    where: { id },
    include: { account: true },
  });

  if (!post) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }
  if (post.status !== "FAILED") {
    return NextResponse.json(
      { error: "Only FAILED posts can be retried" },
      { status: 400 }
    );
  }
  if (!post.driveFileId) {
    return NextResponse.json(
      { error: "No Drive file ID on this post" },
      { status: 400 }
    );
  }

  const account = post.account;

  // Refresh token if needed
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
        },
      });
    }
  }

  // Reset to downloading
  await prisma.scheduledPost.update({
    where: { id },
    data: { status: "DOWNLOADING", errorMessage: null },
  });

  // Retry async
  (async () => {
    try {
      const videoBuffer = await downloadDriveFile(post.driveFileId!);
      await prisma.scheduledPost.update({
        where: { id },
        data: { status: "UPLOADING" },
      });

      const { publishId } = await postVideoToTikTok(
        accessToken,
        videoBuffer,
        post.caption,
        account.postMode as "DIRECT" | "DRAFT"
      );

      await prisma.scheduledPost.update({
        where: { id },
        data: { tiktokPublishId: publishId, status: "PROCESSING" },
      });
    } catch (err) {
      await prisma.scheduledPost.update({
        where: { id },
        data: {
          status: "FAILED",
          errorMessage:
            err instanceof Error ? err.message : "Retry failed",
        },
      });
    }
  })();

  return NextResponse.json({ ok: true });
}
