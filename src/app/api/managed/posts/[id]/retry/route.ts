export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { uploadAndPublish, pollJobStatus } from "@/lib/services/posting-pipeline";

// POST /api/managed/posts/[id]/retry — retry a FAILED post via PostPeer
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "accounts"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

  if (!account.postpeerAccountId) {
    return NextResponse.json(
      { error: "No PostPeer account ID saved on this TikTok account" },
      { status: 400 }
    );
  }

  // 1. Get or create a PostJob for this retry
  let job = await prisma.postJob.findUnique({
    where: {
      driveFileId_accountId: {
        driveFileId: post.driveFileId,
        accountId: post.accountId,
      },
    },
  });

  if (!job) {
    job = await prisma.postJob.create({
      data: {
        driveFileId: post.driveFileId,
        driveFileName: post.driveFileName || "video.mp4",
        accountId: post.accountId,
        state: "CLAIMED",
        attempts: 0,
      },
    });
  } else {
    // Reset state to CLAIMED to allow uploadAndPublish to run
    job = await prisma.postJob.update({
      where: { id: job.id },
      data: {
        state: "CLAIMED",
        attempts: 0, // Reset attempts so it gets up to 3 retries
        tiktokPublishId: null, // Clear old publish ID to trigger a fresh upload
      },
    });
  }

  // 2. Trigger retry upload asynchronously
  (async () => {
    try {
      await uploadAndPublish(job!.id, post.caption);
      // Wait a few seconds and poll immediately
      await new Promise((resolve) => setTimeout(resolve, 5000));
      await pollJobStatus(job!.id);
    } catch (err) {
      console.error(`[Retry] Post retry failed for job ${job!.id}:`, err);
    }
  })();

  return NextResponse.json({ ok: true, message: "Retry started..." });
}
