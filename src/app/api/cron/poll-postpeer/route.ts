export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { pollJobStatus, reconcilePostJobs } from "@/lib/services/posting-pipeline";

function verifyCronSecret(req: NextRequest) {
  const secret =
    req.headers.get("x-cron-secret") ||
    req.nextUrl.searchParams.get("secret");
  return secret === process.env.CRON_SECRET;
}

const POSTPEER_API = "https://api.postpeer.dev/v1";

function getAccessKey(): string {
  const key = process.env.POSTPEER_ACCESS_KEY;
  if (!key) throw new Error("POSTPEER_ACCESS_KEY env var not set");
  return key;
}

// Poll active posting pipeline jobs and run reconciliation/delayed deletions
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Record<string, string> = {};

  // 1. Reconcile stuck/crashed worker jobs, process delayed deletions, and scan drive folders
  try {
    await reconcilePostJobs();
    results["reconciliation"] = "success";
  } catch (recErr: any) {
    console.error("[poll-postpeer] Reconciliation error:", recErr);
    results["reconciliation"] = `failed: ${recErr.message}`;
  }

  // 2. Poll all active UPLOADING jobs in the state machine
  const activeJobs = await prisma.postJob.findMany({
    where: { state: "UPLOADING" },
    select: { id: true, tiktokPublishId: true },
  });

  for (const job of activeJobs) {
    try {
      await pollJobStatus(job.id);
      results[`job_${job.id}`] = "polled";
    } catch (pollErr: any) {
      console.error(`[poll-postpeer] Failed polling job ${job.id}:`, pollErr);
      results[`job_${job.id}`] = `failed: ${pollErr.message}`;
    }
  }

  // 3. Fallback: Legacy backfill for any ScheduledPost records that got published but lack TikTok URLs
  try {
    const posts = await prisma.scheduledPost.findMany({
      where: {
        status: "PUBLISHED",
        tiktokPublishId: { not: null },
        tiktokPostUrl: null,
      },
      include: {
        account: { select: { tiktokUsername: true } },
      },
      take: 20,
    });

    const postpeerKey = getAccessKey();
    for (const post of posts) {
      const postpeerId = post.tiktokPublishId!;
      try {
        const res = await fetch(`${POSTPEER_API}/posts/${postpeerId}`, {
          headers: { "x-access-key": postpeerKey },
        });

        if (!res.ok) {
          results[`legacy_${postpeerId}`] = `failed_status_${res.status}`;
          continue;
        }

        const data = await res.json();
        const postData = data.post || data;
        const platforms = postData.platforms || [];
        const tiktokPlatform = Array.isArray(platforms)
          ? platforms.find((p: any) => p.platform === "tiktok" || p.platformName === "tiktok")
          : null;

        const platformPostUrl = tiktokPlatform?.platformPostUrl || tiktokPlatform?.postUrl || data.platformPostUrl || null;
        const platformPostId = tiktokPlatform?.platformPostId || tiktokPlatform?.postId || data.platformPostId || null;

        if (platformPostUrl || platformPostId) {
          const finalUrl = platformPostUrl
            || (platformPostId && post.account.tiktokUsername
              ? `https://www.tiktok.com/@${post.account.tiktokUsername}/video/${platformPostId}`
              : null);

          await prisma.scheduledPost.update({
            where: { id: post.id },
            data: {
              tiktokPostUrl: finalUrl,
              tiktokVideoId: platformPostId || post.tiktokVideoId,
            },
          });
          results[`legacy_${postpeerId}`] = `backfilled: ${finalUrl}`;
        }
      } catch (err: any) {
        results[`legacy_${postpeerId}`] = `error: ${err.message}`;
      }
    }
  } catch (err: any) {
    console.error("[poll-postpeer] Legacy backfill error:", err);
  }

  return NextResponse.json({
    ok: true,
    activeJobsPolled: activeJobs.length,
    results,
  });
}
