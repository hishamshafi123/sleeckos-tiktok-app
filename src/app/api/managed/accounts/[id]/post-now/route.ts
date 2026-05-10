export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import {
  listVideoFilesInFolder,
  makeFilePublic,
  deleteDriveFile,
} from "@/lib/google";
import { postViaPostPeer, driveDirectUrl } from "@/lib/postpeer";

// POST /api/managed/accounts/[id]/post-now — instantly post next video via PostPeer
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
  if (!account.postpeerAccountId) {
    return NextResponse.json(
      { error: "No PostPeer Account ID set. Add it in the account settings." },
      { status: 400 }
    );
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
      status: "UPLOADING",
    },
  });

  // ── Post via PostPeer (fire-and-forget) ────────────────────────────────────
  const fileId = nextFile.id;
  const postpeerAccountId = account.postpeerAccountId;

  (async () => {
    try {
      // Make the Drive file publicly accessible
      await makeFilePublic(fileId);
      const videoUrl = driveDirectUrl(fileId);

      const result = await postViaPostPeer(
        postpeerAccountId,
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

      // Delete from Drive after success
      try {
        await deleteDriveFile(fileId);
        console.log(`[Drive] Deleted file ${fileId} after successful post`);
      } catch (delErr) {
        console.error(`[Drive] Delete failed for ${fileId}:`, delErr instanceof Error ? delErr.message : delErr);
      }
    } catch (err) {
      await prisma.scheduledPost.update({
        where: { id: post.id },
        data: {
          status: "FAILED",
          errorMessage: `PostPeer failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      });
    }
  })();

  return NextResponse.json({
    ok: true,
    postId: post.id,
    fileName: nextFile.name,
    message: `Posting "${nextFile.name}" via PostPeer...`,
  });
}
