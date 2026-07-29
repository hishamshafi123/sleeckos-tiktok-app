import prisma from "@/lib/db";
import {
  listVideoFilesInFolder,
  makeFilePublic,
  deleteDriveFile,
  revokeFilePublic,
} from "@/lib/google";
import { getMultiplierDriveClient } from "@/app/api/managed/multiplier/google/drive-helper";
import { postViaPostPeer, driveDirectUrl } from "@/lib/postpeer";
import { captureVideoLink } from "@/lib/services/analytics/capture";
import fs from "fs";
import path from "path";

const POSTPEER_API = "https://api.postpeer.dev/v1";

function getAccessKey(): string {
  const key = process.env.POSTPEER_ACCESS_KEY;
  if (!key) throw new Error("POSTPEER_ACCESS_KEY env var not set");
  return key;
}

/**
 * 1. Ingest new video files from Google Drive as AVAILABLE post jobs.
 */
export async function ingestDriveFiles(accountId: string) {
  const account = await prisma.managedAccount.findUnique({
    where: { id: accountId },
    select: { id: true, driveFolderId: true, driveConnected: true },
  });

  if (!account || !account.driveConnected || !account.driveFolderId) {
    return { success: false, reason: "Account not linked to Drive" };
  }

  try {
    const files = await listVideoFilesInFolder(account.driveFolderId, account.id);
    let ingestedCount = 0;

    // Retire jobs whose source file was deleted from Drive — otherwise they
    // keep getting claimed and fail on every attempt forever.
    const liveFileIds = new Set(files.map((f) => f.id).filter(Boolean));
    const staleJobs = await prisma.postJob.findMany({
      where: {
        accountId: account.id,
        state: { in: ["AVAILABLE", "CLAIMED"] },
      },
      select: { id: true, driveFileId: true },
    });
    const vanished = staleJobs.filter((j) => !liveFileIds.has(j.driveFileId));
    if (vanished.length > 0) {
      await prisma.postJob.updateMany({
        where: { id: { in: vanished.map((j) => j.id) } },
        data: {
          state: "DELETED",
          failureReason: "Source file removed from Google Drive",
          lockedAt: null,
          lockedBy: null,
        },
      });
      await prisma.scheduledPost.updateMany({
        where: {
          accountId: account.id,
          driveFileId: { in: vanished.map((j) => j.driveFileId) },
          status: { in: ["QUEUED", "CLAIMED"] },
        },
        data: { status: "SKIPPED", errorMessage: "Source file removed from Google Drive" },
      });
      console.log(`[Ingestion] Retired ${vanished.length} job(s) whose Drive file was deleted (account ${accountId})`);
    }

    for (const file of files) {
      if (!file.id) continue;

      // Check if job or scheduled post already exists for this file
      const existingJob = await prisma.postJob.findUnique({
        where: {
          driveFileId_accountId: {
            driveFileId: file.id,
            accountId: account.id,
          },
        },
      });

      if (!existingJob) {
        // Match a leading "(Campaign Title)" bracket in the file name to a Campaign
        let campaignId: string | null = null;
        const bracketMatch = file.name?.match(/^\(([^)]+)\)/);
        if (bracketMatch) {
          const campaign = await prisma.campaign.findFirst({
            where: { title: { equals: bracketMatch[1].trim(), mode: "insensitive" } },
            select: { id: true },
          });
          campaignId = campaign?.id ?? null;
        }

        // Atomic transaction to create both PostJob and ScheduledPost
        try {
          await prisma.$transaction(async (tx) => {
            await tx.postJob.create({
              data: {
                driveFileId: file.id!,
                driveFileName: file.name || "video.mp4",
                accountId: account.id,
                state: "AVAILABLE",
                campaignId,
              },
            });

            // Create corresponding ScheduledPost so that it is visible in the active post queue
            await tx.scheduledPost.create({
              data: {
                accountId: account.id,
                driveFileId: file.id,
                driveFileName: file.name,
                caption: file.name?.replace(/\.[^.]+$/, "") || "",
                scheduledFor: new Date(),
                status: "QUEUED",
              },
            });
          });
          ingestedCount++;
        } catch (dbErr) {
          // Ignore unique constraint conflicts caused by parallel worker runs
          console.warn(`[Ingestion] Skip duplicate file entry ${file.id}:`, dbErr);
        }
      }
    }

    return { success: true, ingested: ingestedCount };
  } catch (err: any) {
    console.error(`[Ingestion] Failed for account ${accountId}:`, err);
    return { success: false, error: err.message };
  }
}

/**
 * 2. Claim next available video file atomically using SKIP LOCKED.
 */
export async function claimNextVideo(accountId: string, workerId = "worker-default") {
  return await prisma.$transaction(async (tx) => {
    // Select first AVAILABLE job with pessimistic locking, skipping locked rows
    const availableJobs = await tx.$queryRaw<any[]>`
      SELECT id FROM "PostJob"
      WHERE "accountId" = ${accountId}
        AND "state" = 'AVAILABLE'
        AND ("lockedAt" IS NULL OR "lockedAt" < ${new Date(Date.now() - 15 * 60 * 1000)})
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;

    if (!availableJobs || availableJobs.length === 0) {
      return null;
    }

    const jobId = availableJobs[0].id;

    // Transition state to CLAIMED and lock it
    const updatedJob = await tx.postJob.update({
      where: { id: jobId },
      data: {
        state: "CLAIMED",
        lockedAt: new Date(),
        lockedBy: workerId,
      },
    });

    // Sync with ScheduledPost status
    await tx.scheduledPost.updateMany({
      where: { driveFileId: updatedJob.driveFileId, accountId: updatedJob.accountId },
      data: { status: "CLAIMED" },
    });

    return updatedJob;
  });
}

/**
 * 3. Upload video to TikTok via PostPeer and poll to terminal status.
 */
export async function uploadAndPublish(jobId: string, captionOverride?: string) {
  const job = await prisma.postJob.findUnique({
    where: { id: jobId },
    include: { account: true },
  });

  if (!job) throw new Error("Job not found");
  if (job.state !== "CLAIMED") throw new Error(`Cannot post job in state ${job.state}`);

  // Health assertion check
  if (job.account.connectionState !== "healthy") {
    const errorMsg = `Account connection state is unhealthy (${job.account.connectionState}). Error: ${job.account.lastError || "Needs re-authentication."}`;
    console.warn(`[Posting Pipeline] ${errorMsg}`);

    await prisma.postJob.update({
      where: { id: jobId },
      data: {
        state: "FAILED",
        failureReason: errorMsg,
        lockedAt: null,
        lockedBy: null,
      },
    });

    await prisma.scheduledPost.updateMany({
      where: { driveFileId: job.driveFileId, accountId: job.accountId },
      data: {
        status: "FAILED",
        errorMessage: errorMsg,
      },
    });

    throw new Error(errorMsg);
  }

  // Transition state to UPLOADING
  await prisma.postJob.update({
    where: { id: jobId },
    data: { state: "UPLOADING" },
  });

  await prisma.scheduledPost.updateMany({
    where: { driveFileId: job.driveFileId, accountId: job.accountId },
    data: { status: "UPLOADING" },
  });

  const account = job.account;
  const caption = captionOverride || job.driveFileName?.replace(/\.[^.]+$/, "") || "video";

  try {
    // Idempotency guard: Verify if this video has already been published
    if (job.tiktokPublishId) {
      // Already has a publish ID, let's skip re-posting and poll instead
      console.log(`[Posting Pipeline] Job ${jobId} already has publish ID ${job.tiktokPublishId}, skipping upload.`);
      return job;
    }

    // Make Google Drive file temporarily public
    await makeFilePublic(job.driveFileId, account.id);
    const videoUrl = driveDirectUrl(job.driveFileId);

    console.log(`[Posting Pipeline] Uploading job ${jobId} to PostPeer...`);
    const result = await postViaPostPeer(
      account.postpeerAccountId!,
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

    // Save publish ID and update job
    const updatedJob = await prisma.postJob.update({
      where: { id: jobId },
      data: {
        tiktokPublishId: result.postId || null,
        attempts: { increment: 1 },
      },
    });

    await prisma.scheduledPost.updateMany({
      where: { driveFileId: job.driveFileId, accountId: job.accountId },
      data: {
        tiktokPublishId: result.postId || null,
        caption,
      },
    });

    return updatedJob;
  } catch (err: any) {
    const msg = err?.message || String(err);
    // The Drive file was deleted out from under the job — retire it
    // terminally instead of burning retries that can never succeed.
    const fileGone =
      Number(err?.code) === 404 ||
      Number(err?.status) === 404 ||
      /file not found|notfound|does not exist/i.test(msg);
    console.error(`[Posting Pipeline] Upload failed for job ${jobId}:`, err);
    if (fileGone) {
      await prisma.postJob.update({
        where: { id: jobId },
        data: {
          state: "DELETED",
          failureReason: "Source file removed from Google Drive",
          lockedAt: null,
          lockedBy: null,
        },
      });
      await prisma.scheduledPost.updateMany({
        where: {
          driveFileId: job.driveFileId,
          accountId: job.accountId,
          status: { in: ["QUEUED", "CLAIMED"] },
        },
        data: { status: "SKIPPED", errorMessage: "Source file removed from Google Drive" },
      });
    } else {
      await handleFailure(jobId, msg);
    }
    throw err;
  }
}

/**
 * 4. Poll status of a PostPeer job to terminal confirmation.
 */
export async function pollJobStatus(jobId: string) {
  const job = await prisma.postJob.findUnique({
    where: { id: jobId },
    include: { account: true },
  });

  if (!job || !job.tiktokPublishId) return null;
  // Allow CLAIMED too: reconcile-adopted jobs with a publish ID must be able to advance
  if (job.state !== "UPLOADING" && job.state !== "CLAIMED") return job;

  console.log(`[Posting Pipeline] Polling status for job ${jobId} (publishId: ${job.tiktokPublishId})`);

  try {
    const res = await fetch(`${POSTPEER_API}/posts/${job.tiktokPublishId}`, {
      headers: { "x-access-key": getAccessKey() },
    });

    if (!res.ok) {
      console.warn(`[Posting Pipeline] Poll failed with code ${res.status} for job ${jobId}`);
      return job;
    }

    const data = await res.json();
    const postData = data.post || data;
    
    // Check state of the post inside PostPeer
    // Possible post statuses: "published", "publishing", "failed", "queued"
    const status = (postData.status || "processing").toLowerCase();
    
    if (status === "published") {
      const platforms = postData.platforms || [];
      const tiktokPlatform = Array.isArray(platforms)
        ? platforms.find((p: any) => p.platform === "tiktok" || p.platformName === "tiktok")
        : null;

      const platformPostUrl = tiktokPlatform?.platformPostUrl || tiktokPlatform?.postUrl || data.platformPostUrl || null;
      const platformPostId = tiktokPlatform?.platformPostId || tiktokPlatform?.postId || data.platformPostId || null;

      let extractedVideoId: string | null = null;
      if (platformPostId) {
        if (platformPostId.includes(".")) {
          extractedVideoId = platformPostId.split(".").pop() || null;
        } else if (/^\d+$/.test(platformPostId)) {
          extractedVideoId = platformPostId;
        }
      }

      const finalUrl = platformPostUrl || 
        (extractedVideoId && job.account.tiktokUsername 
          ? `https://www.tiktok.com/@${job.account.tiktokUsername}/video/${extractedVideoId}` 
          : null);

      await confirmPublished(jobId, extractedVideoId || undefined, finalUrl || undefined);
    } else if (status === "failed") {
      const errorMsg = postData.errorMessage || postData.error || "PostPeer reported failure";
      await handleFailure(jobId, errorMsg);
    } else {
      console.log(`[Posting Pipeline] Job ${jobId} status is ${status}, still processing...`);
    }

    return await prisma.postJob.findUnique({ where: { id: jobId } });
  } catch (err: any) {
    console.error(`[Posting Pipeline] Error polling status for job ${jobId}:`, err);
    return job;
  }
}

export interface CampaignCaptionConfig {
  fixedTexts: string[];
  descTags: string | null;
  descTagCount: number;
}

/**
 * Resolve the caption config for a post's campaign, if any.
 * Returns null when the job has no campaign.
 */
export async function resolveCampaignCaptionConfig(campaignId: string | null): Promise<CampaignCaptionConfig | null> {
  if (!campaignId) return null;
  return prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { fixedTexts: true, descTags: true, descTagCount: true },
  });
}

/**
 * Build the post caption. Shared by the cron post-scheduler and the manual
 * "post now" flow so both produce identical captions.
 *
 * Chain:
 *  1. Base caption — one random pick from the campaign's fixedTexts pool
 *     (trimmed, non-empty entries). Falls back to the Drive file name
 *     (minus extension) when the pool is empty or there is no campaign.
 *  2. Hashtags — when the campaign has a non-empty descTags pool it
 *     overrides the section pool: descTagCount random tags are picked from
 *     it. Otherwise the section pool (account.section.descTags /
 *     descTagCount) is used.
 */
export function buildPostCaption(
  account: {
    section: { descTags: string | null; descTagCount: number };
  },
  job: { driveFileName: string | null },
  campaign?: CampaignCaptionConfig | null
): string {
  let caption = "";

  const fixedPool = (campaign?.fixedTexts || [])
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (fixedPool.length > 0) {
    caption = fixedPool[Math.floor(Math.random() * fixedPool.length)];
  } else {
    caption = (job.driveFileName || "").replace(/\.[^.]+$/, "");
  }

  // Campaign hashtag pool overrides the section pool when set
  const sec = account.section;
  let descTags = sec.descTags;
  let descTagCount = sec.descTagCount;
  if (campaign?.descTags?.trim()) {
    descTags = campaign.descTags;
    descTagCount = campaign.descTagCount;
  }

  if (descTags && descTagCount > 0) {
    const allTags = descTags
      .split(",")
      .map((t: string) => t.trim())
      .filter((t: string) => t.length > 0);
    if (allTags.length > 0) {
      const shuffled = [...allTags].sort(() => Math.random() - 0.5);
      const picked = shuffled.slice(0, Math.min(descTagCount, allTags.length));
      const tagLine = picked.join(" ");
      caption = caption ? `${caption}\n\n${tagLine}` : tagLine;
    }
  }

  return caption;
}

/**
 * Post the next available video for an account immediately ("post now" flow).
 * Shared by the post-now API route and the agent layer. Throws Errors with
 * user-facing messages; callers map them to HTTP statuses or tool results.
 */
export async function postNowForAccount(accountId: string): Promise<{ jobId: string; fileName: string }> {
  const account = await prisma.managedAccount.findUnique({
    where: { id: accountId },
    include: { section: true },
  });

  if (!account) {
    throw new Error("Account not found");
  }
  if (!account.driveConnected || !account.driveFolderId) {
    throw new Error("No Google Drive folder linked. Link a folder first in Settings.");
  }
  if (!account.postpeerAccountId) {
    throw new Error("No PostPeer Account ID set. Add it in the account settings.");
  }

  // 1. Ingest files from Drive to update the database state
  try {
    await ingestDriveFiles(account.id);
  } catch (err: any) {
    throw new Error(`Drive folder ingestion failed: ${err.message || String(err)}`);
  }

  // 2. Claim the next AVAILABLE post atomically
  const job = await claimNextVideo(account.id, "post-now-button");
  if (!job) {
    throw new Error("No unposted video files in the linked Drive folder.");
  }

  // 3. Compute caption (campaign fixedTexts pool overrides the filename fallback)
  const campaignConfig = await resolveCampaignCaptionConfig(job.campaignId);
  const caption = buildPostCaption(account, job, campaignConfig);

  // 4. Asynchronously start the upload & publish process (handled by pipeline)
  (async () => {
    try {
      await uploadAndPublish(job.id, caption);
      // Run an immediate status poll to complete it faster if upload is quick
      await new Promise((resolve) => setTimeout(resolve, 5000));
      await pollJobStatus(job.id);
    } catch (err) {
      console.error(`[PostNow] Background publish failed for job ${job.id}:`, err);
    }
  })();

  return { jobId: job.id, fileName: job.driveFileName || "video.mp4" };
}

/**
 * 5. Confirm published post, set 5-minute delayed deletion.
 */
export async function confirmPublished(jobId: string, tiktokVideoId?: string, platformPostUrl?: string) {
  const job = await prisma.postJob.findUnique({ where: { id: jobId } });
  if (!job) return;

  const now = new Date();
  const deleteAfter = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes delay

  console.log(`[Posting Pipeline] Confirming publish for job ${jobId}. Deletion scheduled at ${deleteAfter.toISOString()}`);

  await prisma.postJob.update({
    where: { id: jobId },
    data: {
      state: "PENDING_DELETION",
      tiktokPostId: tiktokVideoId || null,
      tiktokPostUrl: platformPostUrl || null,
      publishedAt: now,
      deleteAfter,
    },
  });

  await prisma.scheduledPost.updateMany({
    where: { driveFileId: job.driveFileId, accountId: job.accountId },
    data: {
      status: "PENDING_DELETION",
      tiktokVideoId: tiktokVideoId || null,
      tiktokPostUrl: platformPostUrl || null,
      publishedAt: now,
    },
  });

  if (job.campaignId) {
    await prisma.campaign.update({
      where: { id: job.campaignId },
      data: { postedCount: { increment: 1 } },
    });
    await prisma.campaignEvent.create({
      data: {
        campaignId: job.campaignId,
        type: "post_success",
        meta: {
          accountId: job.accountId,
          driveFileName: job.driveFileName,
          tiktokPostUrl: platformPostUrl || null,
        },
      },
    });
  }

  // Fire-and-forget campaign link capture (Apify). TikTok takes ~1-2 min to
  // surface a new video on the profile, so delay 90s. Capture is fully
  // self-contained — it catches its own errors and never affects posting.
  setTimeout(() => {
    captureVideoLink(jobId).catch((err) =>
      console.error(`[Posting Pipeline] Link capture failed for job ${jobId}:`, err)
    );
  }, 90_000);
}

/**
 * 6. Deletes file from Google Drive after confirmation + delay.
 */
export async function runDeletion(jobId: string) {
  const job = await prisma.postJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  if (job.state !== "PENDING_DELETION") {
    console.warn(`[Posting Pipeline] Deletion skipped: job ${jobId} is in state ${job.state}`);
    return;
  }

  console.log(`[Posting Pipeline] Running Drive deletion for job ${jobId} (file: ${job.driveFileId})`);

  try {
    // Best-effort: revoke public access granted for the upload — non-fatal
    await revokeFilePublic(job.driveFileId, job.accountId).catch(() => {});

    try {
      await deleteDriveFile(job.driveFileId, job.accountId);
    } catch (primaryErr) {
      // Files were uploaded via the multiplier Drive identity — retry with that client
      console.warn(`[Posting Pipeline] Primary delete failed for job ${jobId}, trying multiplier Drive client:`, primaryErr);
      await deleteWithMultiplierClient(job.driveFileId);
    }

    await prisma.postJob.update({
      where: { id: jobId },
      data: { state: "DELETED" },
    });

    await prisma.scheduledPost.updateMany({
      where: { driveFileId: job.driveFileId, accountId: job.accountId },
      data: { status: "DELETED" },
    });

    console.log(`[Posting Pipeline] Drive deletion complete for job ${jobId}`);
  } catch (err: any) {
    console.error(`[Posting Pipeline] Drive deletion failed for job ${jobId}:`, err);
    // Keep in pending_deletion so it will retry during next reconciliation
  }
}

/**
 * Delete a Drive file using the multiplier Drive identity (the account that
 * uploaded the files). Tries permanent delete, then trash, then unparent.
 */
async function deleteWithMultiplierClient(fileId: string): Promise<void> {
  const drive = await getMultiplierDriveClient();
  if (!drive) throw new Error("Multiplier Drive client unavailable");

  try {
    await drive.files.delete({ fileId, supportsAllDrives: true });
    console.log(`[Drive] Permanently deleted file ${fileId} via multiplier client`);
    return;
  } catch (delErr: any) {
    console.warn(`[Drive] multiplier delete() failed for ${fileId}: ${delErr?.message || delErr}`);
  }

  try {
    await drive.files.update({
      fileId,
      requestBody: { trashed: true },
      supportsAllDrives: true,
    });
    console.log(`[Drive] Trashed file ${fileId} via multiplier client`);
    return;
  } catch (trashErr: any) {
    console.warn(`[Drive] multiplier trash() failed for ${fileId}: ${trashErr?.message || trashErr}`);
  }

  const file = await drive.files.get({ fileId, fields: "parents", supportsAllDrives: true });
  const parents = file.data.parents;
  if (parents && parents.length > 0) {
    await drive.files.update({
      fileId,
      removeParents: parents.join(","),
      supportsAllDrives: true,
    });
    console.log(`[Drive] Removed file ${fileId} from parent folder(s) via multiplier client`);
    return;
  }

  throw new Error(`All multiplier-client delete methods failed for ${fileId}`);
}

/**
 * 7. Record failures, handle attempts count and retry backoff.
 */
export async function handleFailure(jobId: string, errorMsg: string) {
  const job = await prisma.postJob.findUnique({ where: { id: jobId } });
  if (!job) return;

  const nextAttempts = job.attempts + 1;
  const maxAttempts = 3;

  if (nextAttempts >= maxAttempts) {
    console.error(`[Posting Pipeline] Job ${jobId} reached max failures. Setting status to FAILED.`);
    await prisma.postJob.update({
      where: { id: jobId },
      data: {
        state: "FAILED",
        failureReason: errorMsg,
        attempts: nextAttempts,
      },
    });

    await prisma.scheduledPost.updateMany({
      where: { driveFileId: job.driveFileId, accountId: job.accountId },
      data: {
        status: "FAILED",
        errorMessage: errorMsg,
      },
    });

    if (job.campaignId) {
      await prisma.campaign.update({
        where: { id: job.campaignId },
        data: { failedCount: { increment: 1 } },
      });
      await prisma.campaignEvent.create({
        data: {
          campaignId: job.campaignId,
          type: "post_failed",
          meta: {
            accountId: job.accountId,
            driveFileName: job.driveFileName,
            failureReason: errorMsg,
          },
        },
      });
    }
  } else {
    // Safe backoff: Unlock it and let it retry in 30 minutes
    const retryTime = new Date(Date.now() + 30 * 60 * 1000);
    console.warn(`[Posting Pipeline] Job ${jobId} failed (attempt ${nextAttempts}/${maxAttempts}). Backing off until ${retryTime.toISOString()}.`);
    
    await prisma.postJob.update({
      where: { id: jobId },
      data: {
        state: "AVAILABLE",
        lockedAt: retryTime, // Lock it until retry window passes
        lockedBy: null,
        attempts: nextAttempts,
        failureReason: errorMsg,
      },
    });

    await prisma.scheduledPost.updateMany({
      where: { driveFileId: job.driveFileId, accountId: job.accountId },
      data: {
        status: "QUEUED", // Re-queue in logs
        errorMessage: `Attempt ${nextAttempts} failed: ${errorMsg}`,
      },
    });
  }
}

/**
 * 8. Reconciliation: Reset stuck worker locks and process scheduled deletions.
 */
export async function reconcilePostJobs() {
  console.log("[Posting Pipeline Reconciliation] Starting periodic check...");

  // 8a. Reset stuck CLAIMED/UPLOADING jobs. UPLOADING jobs WITHOUT a publish ID
  // get a 6h window — a slow PostPeer publish must never be re-posted. Jobs that
  // DO have a publish ID are polled after 30 min so they can advance to deletion.
  const shortTimeout = new Date(Date.now() - 30 * 60 * 1000);
  const uploadTimeout = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const stuckJobs = await prisma.postJob.findMany({
    where: {
      OR: [
        { state: "CLAIMED", lockedAt: { lt: shortTimeout } },
        { state: "UPLOADING", tiktokPublishId: { not: null }, lockedAt: { lt: shortTimeout } },
        { state: "UPLOADING", tiktokPublishId: null, lockedAt: { lt: uploadTimeout } },
      ],
    },
  });

  console.log(`[Posting Pipeline Reconciliation] Found ${stuckJobs.length} stuck jobs to verify`);

  for (const job of stuckJobs) {
    if (job.tiktokPublishId) {
      // If we already have a publish ID, poll its status first to verify if it succeeded
      try {
        await pollJobStatus(job.id);
      } catch (pollErr) {
        console.error(`Reconciliation poll failed for job ${job.id}:`, pollErr);
      }
    } else {
      // No publish ID, safe to unlock and reset to AVAILABLE
      console.log(`[Posting Pipeline Reconciliation] Resetting stuck job ${job.id} without publish ID to AVAILABLE`);
      await prisma.postJob.update({
        where: { id: job.id },
        data: {
          state: "AVAILABLE",
          lockedAt: null,
          lockedBy: null,
        },
      });
      await prisma.scheduledPost.updateMany({
        where: { driveFileId: job.driveFileId, accountId: job.accountId },
        data: { status: "QUEUED" },
      });
    }
  }

  // 8b. Run scheduled deletions for PENDING_DELETION where time passed
  const deletionJobs = await prisma.postJob.findMany({
    where: {
      state: "PENDING_DELETION",
      deleteAfter: { lte: new Date() },
    },
  });

  console.log(`[Posting Pipeline Reconciliation] Found ${deletionJobs.length} scheduled video deletions to run`);
  for (const job of deletionJobs) {
    try {
      await runDeletion(job.id);
    } catch (delErr) {
      console.error(`Reconciliation deletion failed for job ${job.id}:`, delErr);
    }
  }

  // 8c. Ingest new files for all active accounts to keep DB in sync
  const activeAccounts = await prisma.managedAccount.findMany({
    where: { isActive: true, driveConnected: true },
  });

  for (const account of activeAccounts) {
    await ingestDriveFiles(account.id);
  }

  console.log("[Posting Pipeline Reconciliation] Complete.");
}

/**
 * 9. Generate Reconciliation Report data structure.
 */
export async function getReconciliationReport() {
  const publicDir = path.join(process.cwd(), "public");

  // 9a. Stuck in progress jobs
  const stuckLimit = new Date(Date.now() - 15 * 60 * 1000);
  const stuckJobs = await prisma.postJob.findMany({
    where: {
      state: { in: ["CLAIMED", "UPLOADING"] },
      lockedAt: { lt: stuckLimit },
    },
    include: { account: { select: { tiktokUsername: true } } },
  });

  // 9b. Posted but not deleted (should have been deleted after 5m)
  const nonDeletedPublished = await prisma.postJob.findMany({
    where: {
      state: { in: ["PUBLISHED", "PENDING_DELETION"] },
      deleteAfter: { lt: new Date(Date.now() - 10 * 60 * 1000) }, // more than 10 mins old
    },
    include: { account: { select: { tiktokUsername: true } } },
  });

  // 9c. Duplicate posts checks (same driveFileId posted multiple times)
  const duplicatesRaw = await prisma.$queryRaw<any[]>`
    SELECT "driveFileId", "accountId", COUNT(*) as c
    FROM "ScheduledPost"
    WHERE "driveFileId" IS NOT NULL AND "status" = 'PUBLISHED'
    GROUP BY "driveFileId", "accountId"
    HAVING COUNT(*) > 1
  `;

  const duplicates = [];
  for (const dup of duplicatesRaw) {
    const posts = await prisma.scheduledPost.findMany({
      where: { driveFileId: dup.driveFileId, accountId: dup.accountId },
      include: { account: { select: { tiktokUsername: true } } },
    });
    duplicates.push({
      driveFileId: dup.driveFileId,
      accountId: dup.accountId,
      tiktokUsername: posts[0]?.account?.tiktokUsername || "unknown",
      count: Number(dup.c),
      posts: posts.map((p) => ({
        id: p.id,
        publishedAt: p.publishedAt,
        tiktokPostUrl: p.tiktokPostUrl,
      })),
    });
  }

  // 9d. Untracked videos in Drive
  const untracked: { filename: string; fileId: string; tiktokUsername: string }[] = [];
  const accounts = await prisma.managedAccount.findMany({
    where: { isActive: true, driveConnected: true },
  });

  for (const account of accounts) {
    if (!account.driveFolderId) continue;
    try {
      const files = await listVideoFilesInFolder(account.driveFolderId, account.id);
      const knownIds = await prisma.postJob.findMany({
        where: { accountId: account.id },
        select: { driveFileId: true },
      }).then((rows) => new Set(rows.map((r) => r.driveFileId)));

      for (const f of files) {
        if (f.id && !knownIds.has(f.id)) {
          untracked.push({
            filename: f.name || "unknown",
            fileId: f.id,
            tiktokUsername: account.tiktokUsername,
          });
        }
      }
    } catch (err) {
      console.warn(`Drive list failed for report on account ${account.id}`);
    }
  }

  return {
    stuckJobs: stuckJobs.map((j) => ({
      id: j.id,
      state: j.state,
      driveFileName: j.driveFileName,
      lockedAt: j.lockedAt,
      tiktokUsername: j.account.tiktokUsername,
    })),
    notDeleted: nonDeletedPublished.map((j) => ({
      id: j.id,
      state: j.state,
      driveFileName: j.driveFileName,
      publishedAt: j.publishedAt,
      deleteAfter: j.deleteAfter,
      tiktokUsername: j.account.tiktokUsername,
    })),
    duplicates,
    untracked,
  };
}
