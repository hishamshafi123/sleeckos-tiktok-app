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
 *
 * Runs IN-PROCESS in the background with pollable progress: deleting 1,000+
 * files takes minutes — far beyond nginx's 60s proxy timeout — so the POST
 * route starts this and returns immediately. Files are processed in chunks;
 * each chunk's jobs are retired right after its deletes finish, so a crash
 * mid-run never re-processes completed work.
 */

export interface PausedFilesDeletionProgress {
  status: "running" | "done" | "failed";
  total: number;
  processed: number;
  deleted: number;
  failedToDelete: number;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

const deletionRuns = new Map<string, PausedFilesDeletionProgress>();

export function getPausedFilesDeletionProgress(campaignId: string): PausedFilesDeletionProgress | null {
  return deletionRuns.get(campaignId) ?? null;
}

const DELETE_CONCURRENCY = 5;
const CHUNK_SIZE = 50;

async function runPausedFilesDeletion(campaignId: string, progress: PausedFilesDeletionProgress) {
  try {
    for (;;) {
      const jobs = await prisma.postJob.findMany({
        where: { campaignId, state: "AVAILABLE" },
        select: { id: true, driveFileId: true, accountId: true },
        take: CHUNK_SIZE,
      });
      if (jobs.length === 0) break;

      // Delete this chunk's Drive files with a small concurrency pool
      // (Google Drive per-user rate limits make bigger pools pointless).
      let cursor = 0;
      const workers = Array.from({ length: DELETE_CONCURRENCY }, async () => {
        while (cursor < jobs.length) {
          const job = jobs[cursor++];
          try {
            await deleteDriveFile(job.driveFileId, job.accountId);
            progress.deleted++;
          } catch (err: any) {
            const status = err?.response?.status ?? err?.code;
            if (status === 404 || Number(status) === 404) {
              progress.deleted++; // already gone from Drive — counts as done
            } else {
              progress.failedToDelete++;
              console.warn(
                `[Campaign Priority] Drive delete failed for job ${job.id} (file ${job.driveFileId}):`,
                err?.message || err
              );
            }
          }
          progress.processed++;
        }
      });
      await Promise.all(workers);

      // Retire the chunk immediately so a crash can't re-process it.
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
    progress.status = "done";
  } catch (err: any) {
    progress.status = "failed";
    progress.error = err?.message || String(err);
    console.error(`[Campaign Priority] Paused-files deletion failed for campaign ${campaignId}:`, err);
  } finally {
    progress.finishedAt = new Date().toISOString();
  }
}

/**
 * Start (or return the in-flight) background deletion for a campaign.
 * Idempotent: calling while a run is active returns the current progress.
 */
export async function startPausedFilesDeletion(campaignId: string): Promise<PausedFilesDeletionProgress> {
  const existing = deletionRuns.get(campaignId);
  if (existing && existing.status === "running") return existing;

  const total = await prisma.postJob.count({ where: { campaignId, state: "AVAILABLE" } });
  const progress: PausedFilesDeletionProgress = {
    status: "running",
    total,
    processed: 0,
    deleted: 0,
    failedToDelete: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  };
  deletionRuns.set(campaignId, progress);
  void runPausedFilesDeletion(campaignId, progress);
  return progress;
}
