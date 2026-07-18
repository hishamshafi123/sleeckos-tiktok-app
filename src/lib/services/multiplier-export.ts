import prisma from "@/lib/db";
import { getMultiplierDriveClient } from "@/app/api/managed/multiplier/google/drive-helper";
import { downloadFromR2 } from "@/lib/services/storage";
import fs from "fs";
import path from "path";

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

  const res = await drive.files.list({
    q: queryStr,
    fields: "files(id,name,parents)",
    orderBy: "name",
    pageSize: 100,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const folders = res.data.files || [];

  // Find all accounts linked to these folder IDs
  const folderIds = folders.map((f) => f.id).filter(Boolean) as string[];
  const mappedAccounts = await prisma.managedAccount.findMany({
    where: { driveFolderId: { in: folderIds } },
    select: { id: true, driveFolderId: true, tiktokUsername: true },
  });

  return folders.map((f) => {
    const acc = mappedAccounts.find((a) => a.driveFolderId === f.id);
    return {
      id: f.id,
      name: f.name,
      mappedAccount: acc ? { id: acc.id, tiktokUsername: acc.tiktokUsername } : null,
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
  includeExported = false
) {
  if (!groupIds || groupIds.length === 0) {
    throw new Error("No groups selected");
  }

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
  const assigned = folderCounts.reduce((sum, f) => sum + f.count, 0);
  const videosLeft = Math.max(0, totalAvailable - assigned);

  const videoBudget = {
    totalAvailable,
    assigned,
    videosLeft,
  };

  // Sort folders by count descending to solve the hardest/most constrained assignments first
  const sortedFolders = [...folderCounts].sort((a, b) => b.count - a.count);

  const assignments: {
    driveFolderId: string;
    driveFolderName: string;
    videoIds: string[];
  }[] = [];

  const unfulfillable: {
    driveFolderId: string;
    driveFolderName: string;
    requestedCount: number;
    assignedCount: number;
    reason: string;
  }[] = [];

  // Track remaining outputs per group using counters
  const remainingCounts = { ...outputsByGroup };

  for (const folder of sortedFolders) {
    const assignedVideoIds: string[] = [];
    const usedGroupIds = new Set<string>();

    for (let step = 0; step < folder.count; step++) {
      // Find candidate groups that still have videos and haven't contributed to this folder yet
      const candidates = groupIds.filter(
        (gId) => !usedGroupIds.has(gId) && remainingCounts[gId].length > 0
      );

      if (candidates.length === 0) {
        break;
      }

      // Greedy choice: select from the candidate group that has the MOST remaining available videos
      candidates.sort((a, b) => remainingCounts[b].length - remainingCounts[a].length);
      const chosenGroup = candidates[0];

      // Pop the next video
      const video = remainingCounts[chosenGroup].pop()!;
      assignedVideoIds.push(video.id);
      usedGroupIds.add(chosenGroup);
    }

    // Record results
    assignments.push({
      driveFolderId: folder.id,
      driveFolderName: folder.name,
      videoIds: assignedVideoIds,
    });

    if (assignedVideoIds.length < folder.count) {
      unfulfillable.push({
        driveFolderId: folder.id,
        driveFolderName: folder.name,
        requestedCount: folder.count,
        assignedCount: assignedVideoIds.length,
        reason: `Needs ${folder.count} distinct groups, but only ${assignedVideoIds.length} groups have remaining completed videos.`,
      });
    }
  }

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
  plan: SmartExportPlanAssignment[]
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
      createdBy: userId,
      summary: {},
    },
  });

  // Create the SmartExportAssignments and set video statuses to exporting
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
    prisma.multiplierOutput.updateMany({
      where: { id: { in: allVideoIds } },
      data: { exportStatus: "exporting" },
    }),
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

let isExportWorkerRunning = false;

export async function triggerSmartExportWorker() {
  if (isExportWorkerRunning) return;
  isExportWorkerRunning = true;
  processExportQueue().finally(() => {
    isExportWorkerRunning = false;
  });
}

async function processExportQueue() {
  console.log("[Smart Export Worker] Starting processing queue...");

  while (true) {
    const assignment = await prisma.smartExportAssignment.findFirst({
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
      const campaignTitle = (video as any).group?.campaign?.title || (video as any).group?.campaign?.name || "campaign";
      const cleanCampaignSlug = campaignTitle
        .replace(/[^a-zA-Z0-9 ]/g, "")
        .trim()
        .replace(/\s+/g, "_")
        .substring(0, 30);

      const cleanHookSlug = video.hook.text
        .replace(/[^a-zA-Z0-9 ]/g, "")
        .trim()
        .replace(/\s+/g, "_")
        .substring(0, 40);
      const fileName = `${cleanCampaignSlug}_${cleanHookSlug || "video"}_${video.id}.mp4`;

      console.log(`[Smart Export Worker] Uploading ${fileName} to folder ${assignment.driveFolderId}`);
      
      const uploadResult = await uploadWithRetry(drive, localFilePath, fileName, assignment.driveFolderId);
      
      if (!uploadResult.success) {
        throw new Error(uploadResult.error || "Drive upload failed");
      }

      // 4. Mark success
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
      ]);

      console.log(`[Smart Export Worker] Upload complete for assignment: ${assignment.id}`);

    } catch (err: any) {
      const errMsg = err?.message || String(err);
      console.error(`[Smart Export Worker] Assignment ${assignment.id} failed:`, errMsg);

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
    }

    // Update parent job status check
    await updateParentJobStatus(assignment.jobId);

    // Rate limiting: 2s pause
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
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

async function uploadWithRetry(
  drive: any,
  filePath: string,
  fileName: string,
  folderId: string,
  maxRetries = 3
): Promise<{ success: boolean; error?: string }> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const fileStream = fs.createReadStream(filePath);
      await drive.files.create({
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
      return { success: true };
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
