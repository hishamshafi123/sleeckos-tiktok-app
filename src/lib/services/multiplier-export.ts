import prisma from "@/lib/db";
import { getMultiplierDriveClient } from "@/app/api/managed/multiplier/google/drive-helper";
import { naturalCompare } from "@/lib/utils/sorting";
import { downloadFromR2 } from "@/lib/services/storage";
import { assignVideosFairRoundRobin } from "@/lib/services/smart-export-assign";
import fs from "fs";
import path from "path";

// Shared context for color → defaultPostCount resolution
async function getColorResolutionContext() {
  const fallbackSetting = await prisma.appSetting.findUnique({
    where: { key: "defaultPostCountFallback" },
  });
  const defaultFallback = fallbackSetting ? parseInt(fallbackSetting.value, 10) : 1;
  const defaultFallbackCount = isNaN(defaultFallback) ? 1 : defaultFallback;

  const allColors = await prisma.accountColor.findMany({
    select: { color: true, defaultPostCount: true },
  });

  return { defaultFallbackCount, allColors };
}

type ColorResolvableAccount = {
  color: string;
  colorRef?: { color: string; defaultPostCount: number } | null;
};

// Resolves an account's effective color and default post count:
// colorRef relation → legacy color name match → static fallback → AppSetting fallback.
function resolveAccountColorInfo(
  acc: ColorResolvableAccount | null | undefined,
  allColors: { color: string; defaultPostCount: number }[],
  defaultFallbackCount: number
) {
  let defaultCount = defaultFallbackCount;
  let resolvedColor = "zinc";

  if (acc) {
    if (acc.colorRef) {
      // Use the linked AccountColor relation (preferred)
      defaultCount = acc.colorRef.defaultPostCount;
      resolvedColor = acc.colorRef.color;
    } else if (acc.color && acc.color !== "zinc") {
      // Fallback: match legacy color field against AccountColor table
      resolvedColor = acc.color;
      const matchingColor = allColors.find(
        (c) => c.color.toLowerCase() === acc.color.toLowerCase()
      );
      if (matchingColor) {
        defaultCount = matchingColor.defaultPostCount;
      } else {
        // Hardcoded fallback if DB is missing the color
        const staticFallbackCounts: Record<string, number> = {
          green: 3, red: 0, orange: 1, yellow: 1, blue: 1, purple: 1, pink: 1
        };
        const fallback = staticFallbackCounts[acc.color.toLowerCase()];
        if (fallback !== undefined) {
          defaultCount = fallback;
        }
      }
    }
  }

  return { resolvedColor, defaultCount };
}

/**
 * Searches Google Drive folders and maps them to ManagedAccount records.
 */
export async function searchDriveFolders(query: string) {
  const drive = await getMultiplierDriveClient();
  if (!drive) {
    throw new Error("Google Drive connection is not authenticated or connected. Connect Drive in the Manage section first.");
  }

  let queryStr = "mimeType='application/vnd.google-apps.folder' and trashed=false";
  if (query.trim()) {
    // Escape single quotes for Google Drive queries
    queryStr += ` and name contains '${query.replace(/'/g, "\\'")}'`;
  }

  const folders: any[] = [];
  let pageToken: string | undefined = undefined;
  const maxFolders = 500;

  do {
    const res: any = await drive.files.list({
      q: queryStr,
      fields: "nextPageToken, files(id,name,parents)",
      pageSize: 100,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    if (res.data.files) {
      folders.push(...res.data.files);
    }
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken && folders.length < maxFolders);

  // Natural sort the aggregated set
  folders.sort((a, b) => naturalCompare(a.name || "", b.name || ""));

  const { defaultFallbackCount, allColors } = await getColorResolutionContext();

  // Find all accounts linked to these folder IDs
  const folderIds = folders.map((f) => f.id).filter(Boolean) as string[];
  const mappedAccounts = await prisma.managedAccount.findMany({
    where: { driveFolderId: { in: folderIds } },
    select: {
      id: true,
      driveFolderId: true,
      tiktokUsername: true,
      color: true,
      colorId: true,
      colorRef: {
        select: {
          color: true,
          meaning: true,
          defaultPostCount: true,
        },
      },
    },
  });

  return folders.map((f) => {
    const acc = mappedAccounts.find((a) => a.driveFolderId === f.id);
    const { resolvedColor, defaultCount } = resolveAccountColorInfo(acc, allColors, defaultFallbackCount);

    return {
      id: f.id,
      name: f.name,
      defaultPostCount: defaultCount,
      mappedAccount: acc
        ? {
            id: acc.id,
            tiktokUsername: acc.tiktokUsername,
            color: resolvedColor,
          }
        : null,
    };
  });
}

interface FolderCount {
  id: string;
  name: string;
  count: number;
}

/**
 * Validates and previews the Smart Export plan.
 * Spreads each Group's videos across different folders (accounts) to prevent duplicate hits.
 */
export async function previewSmartExport(
  groupIds: string[],
  folderCounts: FolderCount[],
  includeExported = false,
  days: number = 1
) {
  if (!groupIds || groupIds.length === 0) {
    throw new Error("No groups selected");
  }

  // Scale each folder's per-day count by the number of export days
  const safeDays = Math.max(1, Math.floor(days) || 1);
  const scaledFolderCounts = folderCounts.map((f) => ({
    ...f,
    count: Math.max(0, Math.floor(f.count * safeDays)),
  }));

  // Filter out folders with 0 count (excluded accounts/folders)
  const activeFolderCounts = scaledFolderCounts.filter((f) => f.count > 0);

  // 1. Fetch completed outputs for selected groups
  const completedOutputs = await prisma.multiplierOutput.findMany({
    where: {
      groupId: { in: groupIds },
      status: "COMPLETED",
      outputRef: { not: null },
      ...(!includeExported
        ? {
            exportStatus: { not: "exported" },
            exportedAt: null,
          }
        : {}),
    },
    select: {
      id: true,
      groupId: true,
      exportStatus: true,
      exportedAt: true,
      hook: { select: { text: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Group outputs by group ID
  const outputsByGroup: Record<string, typeof completedOutputs> = {};
  groupIds.forEach((gId) => {
    outputsByGroup[gId] = [];
  });
  completedOutputs.forEach((out) => {
    if (outputsByGroup[out.groupId]) {
      outputsByGroup[out.groupId].push(out);
    }
  });

  // Randomize/shuffle each group's output list to distribute varied outputs
  Object.keys(outputsByGroup).forEach((gId) => {
    const arr = outputsByGroup[gId];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  });

  // Total available completed videos
  const totalAvailable = completedOutputs.length;
  const assigned = activeFolderCounts.reduce((sum, f) => sum + f.count, 0);
  const videosLeft = Math.max(0, totalAvailable - assigned);

  const videoBudget = {
    totalAvailable,
    assigned,
    videosLeft,
  };

  // Fair round-robin dealing: each group's (shuffled) videos are dealt one at a
  // time to the eligible folder with the fewest assigned videos, so demand
  // exceeding supply no longer starves the folders dealt to last.
  const videoIdsByGroup: Record<string, string[]> = {};
  groupIds.forEach((gId) => {
    videoIdsByGroup[gId] = outputsByGroup[gId].map((o) => o.id);
  });

  // Cross-run one-variation-per-account: folders that already received an
  // output of a group in ANY previous export are ineligible for that group.
  const priorAssignments = await prisma.smartExportAssignment.findMany({
    where: { sourceGroupId: { in: groupIds }, status: { not: "failed" } },
    select: { driveFolderId: true, sourceGroupId: true },
  });
  const priorGroupsByFolder: Record<string, string[]> = {};
  for (const a of priorAssignments) {
    (priorGroupsByFolder[a.driveFolderId] ??= []).push(a.sourceGroupId);
  }

  const { assignments, unfulfillable } = assignVideosFairRoundRobin(
    groupIds,
    videoIdsByGroup,
    activeFolderCounts,
    priorGroupsByFolder
  );

  return {
    videoBudget,
    assignments,
    unfulfillable,
  };
}

interface SmartExportPlanAssignment {
  driveFolderId: string;
  driveFolderName: string;
  videoIds: string[];
}

/**
 * Creates and runs a new Smart Export background job.
 */
export async function runSmartExport(
  userId: string | null,
  groupIds: string[],
  plan: SmartExportPlanAssignment[],
  days: number = 1
) {
  // Compute flat list of assignments to create
  const flatAssignments: { videoId: string; sourceGroupId: string; driveFolderId: string }[] = [];
  
  // We need to fetch video source group IDs for mapping
  const allVideoIds = plan.flatMap((p) => p.videoIds);
  const videos = await prisma.multiplierOutput.findMany({
    where: { id: { in: allVideoIds } },
    select: { id: true, groupId: true },
  });

  const videoGroupMap = new Map<string, string>();
  videos.forEach((v) => videoGroupMap.set(v.id, v.groupId));

  plan.forEach((p) => {
    p.videoIds.forEach((vId) => {
      const sourceGroupId = videoGroupMap.get(vId);
      if (sourceGroupId) {
        flatAssignments.push({
          videoId: vId,
          sourceGroupId,
          driveFolderId: p.driveFolderId,
        });
      }
    });
  });

  if (flatAssignments.length === 0) {
    throw new Error("No video assignments to run");
  }

  // Create the SmartExportJob
  const job = await prisma.smartExportJob.create({
    data: {
      groupIds,
      status: "pending",
      days: Math.max(1, Math.floor(days) || 1),
      createdBy: userId,
      summary: {},
    },
  });

  // Create the SmartExportAssignments and set video statuses to exporting
  // (per-folder updates so each video also records its destination folder name)
  await prisma.$transaction([
    prisma.smartExportAssignment.createMany({
      data: flatAssignments.map((a) => ({
        jobId: job.id,
        videoId: a.videoId,
        sourceGroupId: a.sourceGroupId,
        driveFolderId: a.driveFolderId,
        status: "pending",
      })),
    }),
    ...plan.map((p) =>
      prisma.multiplierOutput.updateMany({
        where: { id: { in: p.videoIds } },
        data: {
          exportStatus: "exporting",
          exportDestinationFolderId: p.driveFolderId,
          exportDestinationFolderName: p.driveFolderName,
        },
      })
    ),
  ]);

  // Trigger worker asynchronously
  triggerSmartExportWorker().catch((err) => {
    console.error("[Smart Export Service] Failed to trigger background worker:", err);
  });

  return job;
}

/**
 * Retries a single failed assignment upload.
 */
export async function retryExportAssignment(assignmentId: string) {
  const assignment = await prisma.smartExportAssignment.findUnique({
    where: { id: assignmentId },
    include: { job: true },
  });

  if (!assignment) {
    throw new Error("Assignment not found");
  }

  if (assignment.status !== "failed") {
    throw new Error("Can only retry failed assignments");
  }

  // Update status back to pending
  await prisma.smartExportAssignment.update({
    where: { id: assignmentId },
    data: { status: "pending", error: null },
  });

  // Set parent job status back to uploading
  await prisma.smartExportJob.update({
    where: { id: assignment.jobId },
    data: { status: "uploading" },
  });

  // Set video status back to exporting
  await prisma.multiplierOutput.update({
    where: { id: assignment.videoId },
    data: { exportStatus: "exporting" },
  });

  // Trigger worker asynchronously
  triggerSmartExportWorker().catch((err) => {
    console.error("[Smart Export Service] Failed to trigger background worker on retry:", err);
  });

  return { success: true };
}

// ─── Background Processing ──────────────────────────────────────────────────

// Assignments left in "uploading" by a crash/restart are never picked up again
// (the loop only fetches "pending") — older than this, they're reset.
const STALE_UPLOADING_MINUTES = 10;

let isExportWorkerRunning = false;

export async function triggerSmartExportWorker() {
  if (isExportWorkerRunning) return;
  isExportWorkerRunning = true;
  processExportQueue()
    .catch((err) => {
      // Last-resort guard: the loop body is individually hardened, but a
      // throw here must never become an unhandled rejection.
      console.error("[Smart Export Worker] Queue processing crashed:", err);
    })
    .finally(() => {
      isExportWorkerRunning = false;
    });
}

/**
 * Boot/cron resume — the worker loop is in-memory (isExportWorkerRunning dies
 * with the process), so after a deploy or mid-day crash pending assignments
 * would be stranded forever without this. Cheap: the stale-upload reset plus
 * one indexed status count. Called from instrumentation register() and the
 * post-scheduler cron as a safety net.
 */
export async function resumeSmartExportQueue(): Promise<{ resetUploading: number; pending: number }> {
  const staleBefore = new Date(Date.now() - STALE_UPLOADING_MINUTES * 60 * 1000);
  const reset = await prisma.smartExportAssignment.updateMany({
    where: { status: "uploading", updatedAt: { lt: staleBefore } },
    data: { status: "pending" },
  });
  if (reset.count > 0) {
    console.log(`[Smart Export] Recovered ${reset.count} assignment(s) stuck in uploading`);
  }

  // Jobs whose assignments all reached a terminal state but whose status flip
  // was lost to a crash get finalized now.
  await finalizeDrainedJobs();

  const pending = await prisma.smartExportAssignment.count({ where: { status: "pending" } });
  if (pending > 0) {
    console.log(`[Smart Export] Resuming queue: ${pending} pending assignment(s)`);
    triggerSmartExportWorker().catch((err) => {
      console.error("[Smart Export] Failed to trigger worker on resume:", err);
    });
  }
  return { resetUploading: reset.count, pending };
}

/**
 * Job-level "Resume / retry remaining": failed assignments → pending (error
 * cleared), this job's stale uploading → pending, job back to "uploading",
 * worker triggered. Returns what was requeued.
 */
export async function resumeSmartExportJob(jobId: string): Promise<{
  requeuedFailed: number;
  requeuedStaleUploading: number;
  pendingTotal: number;
}> {
  const job = await prisma.smartExportJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("Smart Export Job not found");

  const staleBefore = new Date(Date.now() - STALE_UPLOADING_MINUTES * 60 * 1000);
  const requeueable = await prisma.smartExportAssignment.findMany({
    where: {
      jobId,
      OR: [{ status: "failed" }, { status: "uploading", updatedAt: { lt: staleBefore } }],
    },
    select: { id: true, status: true, videoId: true },
  });
  const requeuedFailed = requeueable.filter((a) => a.status === "failed").length;
  const requeuedStaleUploading = requeueable.length - requeuedFailed;

  if (requeueable.length > 0) {
    await prisma.$transaction([
      prisma.smartExportAssignment.updateMany({
        where: { id: { in: requeueable.map((a) => a.id) } },
        data: { status: "pending", error: null },
      }),
      // Videos of failed assignments were reverted to not_exported on failure —
      // mark them exporting again so they don't look eligible for a new plan.
      prisma.multiplierOutput.updateMany({
        where: { id: { in: requeueable.map((a) => a.videoId) } },
        data: { exportStatus: "exporting" },
      }),
    ]);
  }

  const pendingTotal = await prisma.smartExportAssignment.count({
    where: { jobId, status: "pending" },
  });

  if (pendingTotal > 0) {
    await prisma.smartExportJob.update({
      where: { id: jobId },
      data: { status: "uploading" },
    });
    triggerSmartExportWorker().catch((err) => {
      console.error("[Smart Export Service] Failed to trigger background worker on job resume:", err);
    });
  }

  return { requeuedFailed, requeuedStaleUploading, pendingTotal };
}

// Jobs stuck in pending/uploading whose assignments are ALL terminal (crash
// between the last assignment and the status flip) get their final status.
async function finalizeDrainedJobs() {
  const openJobs = await prisma.smartExportJob.findMany({
    where: { status: { in: ["pending", "uploading"] } },
    include: { assignments: { select: { status: true } } },
  });
  for (const job of openJobs) {
    const anyOpen = job.assignments.some(
      (a) => a.status === "pending" || a.status === "uploading"
    );
    if (!anyOpen && job.assignments.length > 0) {
      await updateParentJobStatus(job.id);
    }
  }
}

async function processExportQueue() {
  console.log("[Smart Export Worker] Starting processing queue...");


  while (true) {
    // Fetch + claim the next pending assignment. A throw here is almost
    // certainly the DB itself — stop the worker (the cron/boot resume
    // re-triggers it) instead of hot-looping on the same row.
    let assignment;
    try {
      assignment = await prisma.smartExportAssignment.findFirst({
        where: { status: "pending" },
        include: {
          video: {
            include: {
              hook: { select: { text: true } },
              group: {
                include: {
                  campaign: {
                    select: { title: true, name: true }
                  }
                }
              }
            },
          },
          job: true,
        },
        orderBy: { id: "asc" },
      });

      if (!assignment) {
        console.log("[Smart Export Worker] Queue empty. Going to sleep.");
        break;
      }

      // Set to uploading
      await prisma.smartExportAssignment.update({
        where: { id: assignment.id },
        data: { status: "uploading" },
      });

      // Update parent job status to uploading if it was pending
      if (assignment.job.status === "pending") {
        await prisma.smartExportJob.update({
          where: { id: assignment.jobId },
          data: { status: "uploading" },
        });
      }
    } catch (err) {
      console.error(
        "[Smart Export Worker] Queue fetch/claim failed — stopping worker (cron resume will retrigger):",
        err
      );
      break;
    }

    try {
      const video = assignment.video;
      if (!video.outputRef) {
        throw new Error("Video has no outputRef rendered file path");
      }

      const publicDir = path.join(process.cwd(), "public");
      const localFilePath = path.join(publicDir, video.outputRef);

      // 1. Check disk, download from R2 if missing
      if (!fs.existsSync(localFilePath)) {
        const key = `uploads/multiplier/renders/multi_${video.id}.mp4`;
        console.log(`[Smart Export Worker] Video not found on disk, downloading from R2: ${key}`);
        await downloadFromR2(key, localFilePath);
      }

      if (!fs.existsSync(localFilePath)) {
        throw new Error(`Video file does not exist on disk or storage: ${video.outputRef}`);
      }

      // 2. Fetch Drive client
      const drive = await getMultiplierDriveClient();
      if (!drive) {
        throw new Error("Google Drive connection is not connected. Please connect Drive first.");
      }

      // 3. Upload to Google Drive
      const campaignTitle: string | null =
        (video as any).group?.campaign?.title || (video as any).group?.campaign?.name || null;
      const cleanCampaignSlug = (campaignTitle || "campaign")
        .replace(/[^a-zA-Z0-9 ]/g, "")
        .trim()
        .replace(/\s+/g, "_")
        .substring(0, 30);

      // Full campaign title in literal parentheses at position 0 — the posting
      // pipeline's parseCampaignBracket() attributes posts to campaigns from it
      // (it tolerates Drive's "Copy of " prefix on duplicated files).
      const campaignPrefix = campaignTitle ? formatCampaignBracketPrefix(campaignTitle) : "";

      const cleanHookSlug = video.hook.text
        .replace(/[^a-zA-Z0-9 ]/g, "")
        .trim()
        .replace(/\s+/g, "_")
        .substring(0, 40);
      const fileName = `${campaignPrefix}${cleanCampaignSlug}_${cleanHookSlug || "video"}_${video.id}.mp4`;

      console.log(`[Smart Export Worker] Uploading ${fileName} to folder ${assignment.driveFolderId}`);
      
      const uploadResult = await uploadWithRetry(drive, localFilePath, fileName, assignment.driveFolderId);
      
      if (!uploadResult.success) {
        throw new Error(uploadResult.error || "Drive upload failed");
      }

      // 4. Mark success
      const groupCampaignId: string | null = (video as any).group?.campaignId || null;
      await prisma.$transaction([
        prisma.smartExportAssignment.update({
          where: { id: assignment.id },
          data: { status: "done", error: null },
        }),
        prisma.multiplierOutput.update({
          where: { id: video.id },
          data: {
            exportStatus: "exported",
            exportedAt: new Date(),
            exportDestinationFolderId: assignment.driveFolderId,
          },
        }),
        // Durable campaign stat: survives later deletion of the group/output rows
        ...(groupCampaignId
          ? [
              prisma.campaign.update({
                where: { id: groupCampaignId },
                data: { exportedCount: { increment: 1 } },
              }),
              prisma.campaignEvent.create({
                data: {
                  campaignId: groupCampaignId,
                  type: "export",
                  meta: {
                    driveFolderId: assignment.driveFolderId,
                    groupId: video.groupId,
                    groupName: (video as any).group?.name || null,
                    jobId: assignment.jobId,
                  },
                },
              }),
            ]
          : []),
      ]);

      console.log(`[Smart Export Worker] Upload complete for assignment: ${assignment.id}`);

    } catch (err: any) {
      // One bad video must never kill the loop: mark THIS assignment failed
      // with the real error and continue with the next one. If the failure
      // was the DB itself, the mark-failed write may also fail — log it and
      // let the next iteration's fetch decide whether to stop.
      const errMsg = err?.message || String(err);
      console.error(`[Smart Export Worker] Assignment ${assignment.id} failed:`, errMsg);

      try {
        await prisma.$transaction([
          prisma.smartExportAssignment.update({
            where: { id: assignment.id },
            data: { status: "failed", error: errMsg },
          }),
          prisma.multiplierOutput.update({
            where: { id: assignment.videoId },
            data: { exportStatus: "not_exported" }, // Revert to eligible for export
          }),
        ]);
      } catch (markErr) {
        console.error(
          `[Smart Export Worker] Failed to mark assignment ${assignment.id} as failed:`,
          markErr
        );
      }
    }

    // Update parent job status check
    await updateParentJobStatus(assignment.jobId).catch((err) => {
      console.error(`[Smart Export Worker] Parent status update failed for job ${assignment.jobId}:`, err);
    });

    // Rate limiting: 2s pause
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  // Queue drained — finalize any job whose status flip was lost to a crash.
  await finalizeDrainedJobs().catch((err) => {
    console.error("[Smart Export Worker] Drained-job finalization failed:", err);
  });
}

async function updateParentJobStatus(jobId: string) {
  const assignments = await prisma.smartExportAssignment.findMany({
    where: { jobId },
  });

  const allFinished = assignments.every((a) => a.status === "done" || a.status === "failed");
  if (allFinished) {
    const successCount = assignments.filter((a) => a.status === "done").length;
    const failedCount = assignments.filter((a) => a.status === "failed").length;
    const finalStatus = failedCount > 0 ? "failed" : "done";

    const summary = {
      total: assignments.length,
      successCount,
      failedCount,
      completedAt: new Date().toISOString(),
    };

    await prisma.smartExportJob.update({
      where: { id: jobId },
      data: {
        status: finalStatus,
        summary,
      },
    });
  }
}

// Builds the "(Campaign Title) " filename prefix. Keeps the full human-readable
// title (spaces intact) and only strips characters illegal in Drive file names.
export function formatCampaignBracketPrefix(campaignTitle: string): string {
  const safeTitle = campaignTitle.replace(/[/\\]/g, " ").replace(/\s+/g, " ").trim();
  return safeTitle ? `(${safeTitle}) ` : "";
}

// Finds a file with the exact same name already sitting in the target folder.
async function findExistingDriveFile(
  drive: any,
  fileName: string,
  folderId: string
): Promise<string | null> {
  const escapedName = fileName.replace(/'/g, "\\'");
  const res = await drive.files.list({
    q: `name = '${escapedName}' and '${folderId}' in parents and trashed = false`,
    fields: "files(id,name)",
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return res.data.files?.[0]?.id || null;
}

async function uploadWithRetry(
  drive: any,
  filePath: string,
  fileName: string,
  folderId: string,
  maxRetries = 3
): Promise<{ success: boolean; fileId?: string; error?: string }> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Dedup guard: a previous attempt may have created the file server-side but
      // timed out before we saw the response — reuse it instead of duplicating.
      const existingId = await findExistingDriveFile(drive, fileName, folderId);
      if (existingId) {
        console.log(`[Smart Export Drive] Dedup hit: "${fileName}" already exists in folder ${folderId} (file id: ${existingId}) — skipping re-upload`);
        return { success: true, fileId: existingId };
      }

      const fileStream = fs.createReadStream(filePath);
      const res = await drive.files.create({
        requestBody: {
          name: fileName,
          parents: [folderId],
        },
        media: {
          mimeType: "video/mp4",
          body: fileStream,
        },
        fields: "id",
        supportsAllDrives: true,
      });
      return { success: true, fileId: res.data.id };
    } catch (err: any) {
      const status = err?.response?.status || err?.code;
      const message = err?.response?.data?.error?.message || err?.message || String(err);

      if (status === 401 || status === 403) {
        return { success: false, error: `Auth error (${status}): ${message}` };
      }

      console.warn(`[Smart Export Drive] Upload attempt ${attempt}/${maxRetries} failed: ${message}`);

      if (attempt < maxRetries) {
        const backoff = Math.pow(3, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }
  return { success: false, error: "Failed after 3 retries" };
}

// ─── Account-based adapters (new /api/multiplier namespace) ─────────────────

interface AccountAllocation {
  driveFolderId: string;
  name?: string;
  count: number;
}

/**
 * Adapter over previewSmartExport that takes account-shaped allocations
 * instead of raw folder counts.
 */
export async function previewSmartExportAccounts(input: {
  groupIds: string[];
  accounts: AccountAllocation[];
  days?: number;
  includeExported?: boolean;
}) {
  const days = Math.max(1, Math.floor(input.days ?? 1) || 1);
  const folderCounts: FolderCount[] = (input.accounts || []).map((a) => ({
    id: a.driveFolderId,
    name: a.name || "",
    count: a.count,
  }));

  const result = await previewSmartExport(input.groupIds, folderCounts, !!input.includeExported, days);
  return { ...result, days };
}

/**
 * Unified search over export destinations.
 * mode "drive"   → Google Drive folders (delegates to searchDriveFolders)
 * mode "account" → ManagedAccounts with a linked Drive folder
 */
export async function searchAccounts(input: { q: string; mode?: "drive" | "account" }) {
  const q = input.q || "";
  const mode = input.mode || "drive";

  if (mode === "account") {
    const accounts = await prisma.managedAccount.findMany({
      where: {
        driveFolderId: { not: null },
        OR: [
          { tiktokUsername: { contains: q, mode: "insensitive" } },
          { tiktokDisplayName: { contains: q, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        tiktokUsername: true,
        driveFolderId: true,
        driveFolderName: true,
        color: true,
        colorId: true,
        colorRef: {
          select: {
            color: true,
            meaning: true,
            defaultPostCount: true,
          },
        },
      },
    });

    accounts.sort((a, b) => naturalCompare(a.tiktokUsername, b.tiktokUsername));

    const { defaultFallbackCount, allColors } = await getColorResolutionContext();

    return accounts.map((acc) => {
      const { resolvedColor, defaultCount } = resolveAccountColorInfo(acc, allColors, defaultFallbackCount);
      return {
        driveFolderId: acc.driveFolderId as string,
        driveFolderName: acc.driveFolderName || acc.tiktokUsername,
        color: resolvedColor,
        defaultPostCount: defaultCount,
        account: {
          id: acc.id,
          tiktokUsername: acc.tiktokUsername,
        },
      };
    });
  }

  // mode "drive"
  const folders = await searchDriveFolders(q);
  return folders.map((f) => ({
    driveFolderId: f.id,
    driveFolderName: f.name,
    color: f.mappedAccount?.color ?? null,
    defaultPostCount: f.defaultPostCount,
    account: f.mappedAccount
      ? { id: f.mappedAccount.id, tiktokUsername: f.mappedAccount.tiktokUsername }
      : null,
  }));
}
