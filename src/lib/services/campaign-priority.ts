import prisma from "@/lib/db";
import { deleteDriveFile, getServiceAccountDriveClient } from "@/lib/google";
import { parseCampaignBracket, canonicalDriveFileName } from "@/lib/services/posting-pipeline";
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

// ── Rescan: find every Drive file carrying this campaign's bracket ──────────
// The parked-files list is built from AVAILABLE PostJobs, but files can be
// sitting in Drive with no live job: a deletion ran while Drive credentials
// were broken (jobs retired, files kept), fresh copies were re-exported with
// new file ids and never ingested (dedupe blocked them at landing time, and
// backed-off accounts were never re-ingested), or the per-folder listing cap
// hid them. Rather than reverse-engineering those paths, this searches Drive
// directly for "(Campaign Title)" files across all account folders (fully
// paginated) and reconciles each one:
//   - no job for the file        → create AVAILABLE job (+ QUEUED post)
//   - job retired by removal     → resurrect to AVAILABLE
//   - live job already exists    → leave it (it shows in the list already)
// Everything found ends up deletable via the normal "Delete these files" run.

export interface PausedFilesRescanProgress {
  status: "running" | "done" | "failed";
  totalFiles: number;
  processed: number;
  resurrected: number;
  ingested: number;
  skipped: number;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

const rescanRuns = new Map<string, PausedFilesRescanProgress>();

export function getPausedFilesRescanProgress(campaignId: string): PausedFilesRescanProgress | null {
  return rescanRuns.get(campaignId) ?? null;
}

const LIVE_JOB_STATES = ["AVAILABLE", "CLAIMED", "UPLOADING", "PENDING_DELETION"];

async function runPausedFilesRescan(campaignId: string, progress: PausedFilesRescanProgress) {
  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { title: true },
    });
    if (!campaign?.title) throw new Error("Campaign not found");

    // Full Drive search for "(Title)" video files (paginates the entire
    // match set — per-folder listings cap at 100 and miss files).
    const drive = await getServiceAccountDriveClient();
    const q = `name contains '(${campaign.title.replace(/'/g, "\\'")}' and mimeType contains 'video/' and trashed=false`;
    const found: { id: string; name: string; parent: string }[] = [];
    let pageToken: string | undefined;
    do {
      const res: any = await drive.files.list({
        q,
        fields: "nextPageToken, files(id,name,parents)",
        pageSize: 1000,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      for (const f of res.data.files || []) {
        if (!f.id || !f.name) continue;
        // Drive "contains" is substring-based — verify the exact bracket.
        const bracket = parseCampaignBracket(f.name);
        if (bracket && bracket.toLowerCase() === campaign.title.toLowerCase()) {
          found.push({ id: f.id, name: f.name, parent: f.parents?.[0] ?? "" });
        }
      }
      pageToken = res.data.nextPageToken || undefined;
    } while (pageToken);

    // Scope: only files parked in a managed account's Drive folder.
    const accounts = await prisma.managedAccount.findMany({
      where: { driveFolderId: { not: null } },
      select: { id: true, driveFolderId: true },
    });
    const accountByFolder = new Map(accounts.map((a) => [a.driveFolderId as string, a.id]));
    const inScope = found.filter((f) => f.parent && accountByFolder.has(f.parent));
    progress.totalFiles = inScope.length;

    // Existing jobs for these files, keyed by driveFileId:accountId.
    const existingJobs = await prisma.postJob.findMany({
      where: { driveFileId: { in: inScope.map((f) => f.id) } },
      select: { id: true, driveFileId: true, accountId: true, state: true, failureReason: true },
    });
    const jobByFile = new Map(existingJobs.map((j) => [`${j.driveFileId}:${j.accountId}`, j]));

    // Canonical names of LIVE jobs per account (same duplicate protection as
    // ingest: a live twin must not be queued twice).
    const liveJobs = await prisma.postJob.findMany({
      where: { campaignId, state: { in: LIVE_JOB_STATES } },
      select: { accountId: true, driveFileName: true },
    });
    const liveNamesByAccount = new Map<string, Set<string>>();
    for (const j of liveJobs) {
      const set = liveNamesByAccount.get(j.accountId) ?? new Set<string>();
      set.add(canonicalDriveFileName(j.driveFileName));
      liveNamesByAccount.set(j.accountId, set);
    }

    for (const file of inScope) {
      const accountId = accountByFolder.get(file.parent)!;
      const job = jobByFile.get(`${file.id}:${accountId}`);
      try {
        if (!job) {
          if (liveNamesByAccount.get(accountId)?.has(canonicalDriveFileName(file.name))) {
            progress.skipped++; // a live twin is already queued for this video
          } else {
            await prisma.$transaction(async (tx) => {
              await tx.postJob.create({
                data: {
                  driveFileId: file.id,
                  driveFileName: file.name,
                  accountId,
                  state: "AVAILABLE",
                  campaignId,
                },
              });
              await tx.scheduledPost.create({
                data: {
                  accountId,
                  driveFileId: file.id,
                  driveFileName: file.name,
                  caption: "",
                  scheduledFor: new Date(),
                  status: "QUEUED",
                },
              });
            });
            progress.ingested++;
          }
        } else if (job.state === "FAILED" && job.failureReason === PAUSED_REMOVAL_NOTE) {
          await prisma.postJob.update({
            where: { id: job.id },
            data: { state: "AVAILABLE", failureReason: null, lockedAt: null, lockedBy: null },
          });
          await prisma.scheduledPost.updateMany({
            where: {
              accountId,
              driveFileId: file.id,
              status: "SKIPPED",
              errorMessage: PAUSED_REMOVAL_NOTE,
            },
            data: { status: "QUEUED", errorMessage: null },
          });
          progress.resurrected++;
        } else {
          progress.skipped++;
        }
      } catch (err: any) {
        console.warn(`[Campaign Priority] Rescan failed for file ${file.id}:`, err?.message || err);
      }
      progress.processed++;
    }
    progress.status = "done";
  } catch (err: any) {
    progress.status = "failed";
    progress.error = err?.message || String(err);
    console.error(`[Campaign Priority] Paused-files rescan failed for campaign ${campaignId}:`, err);
  } finally {
    progress.finishedAt = new Date().toISOString();
  }
}

/** Start (or return the in-flight) rescan for a campaign. Idempotent. */
export async function startPausedFilesRescan(campaignId: string): Promise<PausedFilesRescanProgress> {
  const existing = rescanRuns.get(campaignId);
  if (existing && existing.status === "running") return existing;

  const progress: PausedFilesRescanProgress = {
    status: "running",
    totalFiles: 0,
    processed: 0,
    resurrected: 0,
    ingested: 0,
    skipped: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  };
  rescanRuns.set(campaignId, progress);
  void runPausedFilesRescan(campaignId, progress);
  return progress;
}
