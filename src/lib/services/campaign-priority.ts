import prisma from "@/lib/db";
import { deleteDriveFile } from "@/lib/google";
import { CampaignStatus } from "@prisma/client";

export const PAUSED_REMOVAL_NOTE = "Campaign paused — file removed from Drive";

/**
 * Set (or clear) a campaign's posting priority quota.
 * quota null/0 clears the priority; setting a new quota resets priorityUsed.
 */
export async function setCampaignPriority(campaignId: string, quota: number | null) {
  const normalized = quota && quota > 0 ? Math.floor(quota) : null;
  return prisma.campaign.update({
    where: { id: campaignId },
    data: { priorityQuota: normalized, priorityUsed: 0 },
    select: { priorityQuota: true, priorityUsed: true },
  });
}

/**
 * Pause or resume a campaign. Paused campaigns are excluded from claiming
 * immediately (see claimNextVideo in posting-pipeline.ts).
 */
export async function setCampaignStatus(campaignId: string, status: "ACTIVE" | "PAUSED") {
  return prisma.campaign.update({
    where: { id: campaignId },
    data: { status: status as CampaignStatus },
    select: { status: true },
  });
}

/**
 * AVAILABLE PostJobs of a campaign, grouped by the owning account's Drive folder.
 */
export async function getPausedCampaignFiles(campaignId: string) {
  const jobs = await prisma.postJob.findMany({
    where: { campaignId, state: "AVAILABLE" },
    select: {
      id: true,
      account: { select: { driveFolderId: true, driveFolderName: true } },
    },
  });

  const byFolder = new Map<string, { driveFolderId: string | null; driveFolderName: string | null; fileCount: number }>();
  for (const job of jobs) {
    const key = job.account.driveFolderId || "unknown";
    const entry = byFolder.get(key) || {
      driveFolderId: job.account.driveFolderId,
      driveFolderName: job.account.driveFolderName,
      fileCount: 0,
    };
    entry.fileCount++;
    byFolder.set(key, entry);
  }

  const folders = [...byFolder.values()];
  return { folders, totalFiles: jobs.length };
}

/**
 * Remove the Drive file behind every AVAILABLE job of a (paused) campaign,
 * best-effort, then retire the jobs and their ScheduledPosts so they are
 * never claimed again.
 */
export async function deletePausedCampaignFiles(campaignId: string) {
  const jobs = await prisma.postJob.findMany({
    where: { campaignId, state: "AVAILABLE" },
    select: { id: true, driveFileId: true, accountId: true },
  });

  let deleted = 0;
  let failedToDelete = 0;
  for (const job of jobs) {
    try {
      await deleteDriveFile(job.driveFileId, job.accountId);
      deleted++;
    } catch (err) {
      failedToDelete++;
      console.warn(`[Campaign Priority] Drive delete failed for job ${job.id} (file ${job.driveFileId}):`, err);
    }
  }

  if (jobs.length > 0) {
    await prisma.postJob.updateMany({
      where: { id: { in: jobs.map((j) => j.id) } },
      data: { state: "FAILED", failureReason: PAUSED_REMOVAL_NOTE, lockedAt: null, lockedBy: null },
    });
    await prisma.scheduledPost.updateMany({
      where: {
        accountId: { in: [...new Set(jobs.map((j) => j.accountId))] },
        driveFileId: { in: jobs.map((j) => j.driveFileId) },
        status: { in: ["QUEUED", "CLAIMED"] },
      },
      data: { status: "SKIPPED", errorMessage: PAUSED_REMOVAL_NOTE },
    });
  }

  return { deleted, failedToDelete, jobsMarked: jobs.length };
}
