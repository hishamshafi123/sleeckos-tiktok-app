import prisma from "@/lib/db";
import { getMultiplierDriveClient, getCachedMultiplierDriveClient } from "@/app/api/managed/multiplier/google/drive-helper";
import { naturalCompare } from "@/lib/utils/sorting";
import { downloadFromR2 } from "@/lib/services/storage";
import { assignVideosFairRoundRobin } from "@/lib/services/smart-export-assign";
import fs from "fs";
import path from "path";
import { createHash, randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import {
  EXPORT_ADMISSION_POOL_LIMIT,
  exportAdmissionController,
  getMultiplierPerformanceState,
} from "./multiplier-performance";
import { smartExportDriveRequestPacer } from "./drive-request-pacer";

interface DriveFileSummary {
  id?: string | null;
  name?: string | null;
}

interface DriveListResponse {
  data: {
    files?: DriveFileSummary[] | null;
    nextPageToken?: string | null;
  };
}

interface SmartExportDriveClient {
  files: {
    list(request: {
      q: string;
      fields?: string;
      pageSize?: number;
      pageToken?: string;
      supportsAllDrives?: boolean;
      includeItemsFromAllDrives?: boolean;
    }): Promise<DriveListResponse>;
    create(request: {
      requestBody: { name: string; parents: string[] };
      media: { mimeType: string; body: fs.ReadStream };
      fields?: string;
      supportsAllDrives?: boolean;
    }): Promise<{ data: { id?: string | null } }>;
  };
}

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

  const folders: DriveFileSummary[] = [];
  let pageToken: string | undefined = undefined;

  // Paginate the ENTIRE match set — Drive returns pages unordered, so any
  // cutoff would silently drop folders before the natural sort below runs.
  do {
    const res: DriveListResponse = await drive.files.list({
      q: queryStr,
      fields: "nextPageToken, files(id,name,parents)",
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    if (res.data.files) {
      folders.push(...res.data.files);
    }
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

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
      exportStatus: includeExported ? { not: "exporting" } : { notIn: ["exporting", "exported"] },
      ...(!includeExported ? { exportedAt: null } : {}),
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

interface SmartExportRunOptions {
  idempotencyKey?: string;
  requestHash?: string;
  includeExported?: boolean;
  startWorker?: boolean;
}

export class SmartExportRequestConflictError extends Error {}
export class SmartExportReservationError extends Error {}

export function createSmartExportRequestHash(input: {
  groupIds: string[];
  accounts?: AccountAllocation[];
  plan?: SmartExportPlanAssignment[];
  days?: number;
  includeExported?: boolean;
  countsAreTotal?: boolean;
}): string {
  const accounts = input.accounts?.map((a) => ({
    driveFolderId: a.driveFolderId,
    name: a.name || "",
    count: a.count,
  })).sort((a, b) => a.driveFolderId.localeCompare(b.driveFolderId) || a.name.localeCompare(b.name));
  const plan = input.plan?.map((p) => ({
    driveFolderId: p.driveFolderId,
    driveFolderName: p.driveFolderName || "",
    videoIds: [...p.videoIds].sort(),
  })).sort((a, b) => a.driveFolderId.localeCompare(b.driveFolderId));

  return createHash("sha256").update(JSON.stringify({
    groupIds: [...input.groupIds].sort(),
    accounts,
    plan,
    days: Math.max(1, Math.floor(input.days ?? 1) || 1),
    includeExported: !!input.includeExported,
    countsAreTotal: !!input.countsAreTotal,
  })).digest("hex");
}

function assertMatchingRequest(job: { requestHash: string | null }, requestHash?: string) {
  if ((job.requestHash || null) !== (requestHash || null)) {
    throw new SmartExportRequestConflictError("This idempotency key belongs to a different export request");
  }
}

export async function findSmartExportJobByRequestKey(idempotencyKey: string, requestHash?: string) {
  const job = await prisma.smartExportJob.findUnique({ where: { idempotencyKey } });
  if (job) assertMatchingRequest(job, requestHash);
  return job;
}

/**
 * Creates and runs a new Smart Export background job.
 */
export async function runSmartExport(
  userId: string | null,
  groupIds: string[],
  plan: SmartExportPlanAssignment[],
  days: number = 1,
  options: SmartExportRunOptions = {}
) {
  const idempotencyKey = options.idempotencyKey?.trim() || undefined;
  const includeExported = options.includeExported === true;
  const startWorker = options.startWorker !== false;
  if (idempotencyKey && !options.requestHash) {
    throw new Error("A request hash is required when using an idempotency key");
  }
  if (idempotencyKey) {
    const existing = await findSmartExportJobByRequestKey(idempotencyKey, options.requestHash);
    if (existing) {
      if (startWorker) {
        triggerSmartExportWorker().catch((err) => {
          console.error("[Smart Export Service] Failed to retrigger background worker:", err);
        });
      }
      return { job: existing, replayed: true };
    }
  }

  try {
    const job = await prisma.$transaction(async (tx) => {
      const allVideoIds = plan.flatMap((p) => p.videoIds);
      if (allVideoIds.length === 0) {
        throw new Error("No video assignments to run");
      }
      const uniqueVideoIds = new Set(allVideoIds);
      if (uniqueVideoIds.size !== allVideoIds.length) {
        throw new SmartExportReservationError("Each video can only be assigned once in an export plan");
      }

      const videos = await tx.multiplierOutput.findMany({
        where: { id: { in: [...uniqueVideoIds] } },
        select: { id: true, groupId: true },
      });
      if (videos.length !== uniqueVideoIds.size) {
        throw new SmartExportReservationError(
          "Some videos are no longer available. Refresh the preview and try again."
        );
      }

      const selectedGroupIds = new Set(groupIds);
      const videoGroupMap = new Map(videos.map((v) => [v.id, v.groupId]));
      const flatAssignments = plan.flatMap((p) => p.videoIds.map((videoId) => {
        const sourceGroupId = videoGroupMap.get(videoId);
        if (!sourceGroupId || !selectedGroupIds.has(sourceGroupId)) {
          throw new SmartExportReservationError(
            "The export plan contains a video outside the selected groups. Refresh the preview and try again."
          );
        }
        return {
          videoId,
          sourceGroupId,
          driveFolderId: p.driveFolderId,
          driveFolderName: p.driveFolderName || "",
        };
      }));

      const pairsByKey = new Map<string, {
        pairKey: string;
        driveFolderId: string;
        sourceGroupId: string;
      }>();
      for (const assignment of flatAssignments) {
        const pairKey = JSON.stringify([assignment.driveFolderId, assignment.sourceGroupId]);
        if (pairsByKey.has(pairKey)) {
          throw new SmartExportReservationError(
            "The export plan assigns more than one video from the same source group to a Drive folder"
          );
        }
        pairsByKey.set(pairKey, {
          pairKey,
          driveFolderId: assignment.driveFolderId,
          sourceGroupId: assignment.sourceGroupId,
        });
      }
      const folderGroupPairs = [...pairsByKey.values()].sort((a, b) =>
        a.pairKey < b.pairKey ? -1 : a.pairKey > b.pairKey ? 1 : 0
      );

      const created = await tx.smartExportJob.create({
        data: {
          groupIds,
          status: "pending",
          days: Math.max(1, Math.floor(days) || 1),
          createdBy: userId,
          idempotencyKey,
          requestHash: options.requestHash,
          summary: {},
        },
      });

      await tx.$queryRaw<Array<{ locked: number }>>`
        SELECT 1 AS "locked"
        FROM (
          SELECT "pairKey"
          FROM jsonb_to_recordset(${JSON.stringify(folderGroupPairs)}::jsonb)
            AS item("pairKey" text, "driveFolderId" text, "sourceGroupId" text)
          ORDER BY "pairKey"
          OFFSET 0
        ) AS pair
        WHERE pg_advisory_xact_lock(hashtextextended(pair."pairKey", 0)) IS NOT NULL
        ORDER BY pair."pairKey"
      `;

      const conflictingPairs = await tx.$queryRaw<Array<{ pairKey: string }>>`
        SELECT pair."pairKey"
        FROM jsonb_to_recordset(${JSON.stringify(folderGroupPairs)}::jsonb)
          AS pair("pairKey" text, "driveFolderId" text, "sourceGroupId" text)
        WHERE EXISTS (
          SELECT 1
          FROM "SmartExportAssignment" AS existing
          WHERE existing."driveFolderId" = pair."driveFolderId"
            AND existing."sourceGroupId" = pair."sourceGroupId"
            AND existing.status <> 'failed'
        )
        LIMIT 1
      `;
      if (conflictingPairs.length > 0) {
        throw new SmartExportReservationError(
          "A source group is already assigned to one of these Drive folders. Refresh the preview and try again."
        );
      }

      const reservedCount = await tx.$executeRaw`
        UPDATE "MultiplierOutput" AS output
        SET
          "exportStatus" = 'exporting',
          "exportDestinationFolderId" = reservation."driveFolderId",
          "exportDestinationFolderName" = reservation."driveFolderName",
          "updatedAt" = NOW()
        FROM (
          SELECT *
          FROM jsonb_to_recordset(${JSON.stringify(flatAssignments)}::jsonb)
            AS item("videoId" text, "sourceGroupId" text, "driveFolderId" text, "driveFolderName" text)
        ) AS reservation
        WHERE output.id = reservation."videoId"
          AND output.status = 'COMPLETED'
          AND output."outputRef" IS NOT NULL
          AND output."exportStatus" <> 'exporting'
          AND (
            ${includeExported}::boolean
            OR (output."exportStatus" = 'not_exported' AND output."exportedAt" IS NULL)
          )
      `;

      if (reservedCount !== flatAssignments.length) {
        throw new SmartExportReservationError(
          "Some videos are already exporting, already exported, or no longer render-complete. Refresh the preview and try again."
        );
      }

      await tx.smartExportAssignment.createMany({
        data: flatAssignments.map((a) => ({
          jobId: created.id,
          videoId: a.videoId,
          sourceGroupId: a.sourceGroupId,
          driveFolderId: a.driveFolderId,
          status: "pending",
        })),
      });

      return created;
    }, { maxWait: 15_000, timeout: 60_000 });

    if (startWorker) {
      triggerSmartExportWorker().catch((err) => {
        console.error("[Smart Export Service] Failed to trigger background worker:", err);
      });
    }

    return { job, replayed: false };
  } catch (err: unknown) {
    const isUniqueConstraintRace =
      typeof err === "object" && err !== null && "code" in err && err.code === "P2002";
    if (idempotencyKey && isUniqueConstraintRace) {
      const existing = await findSmartExportJobByRequestKey(idempotencyKey, options.requestHash);
      if (existing) {
        if (startWorker) {
          triggerSmartExportWorker().catch((triggerErr) => {
            console.error("[Smart Export Service] Failed to retrigger background worker:", triggerErr);
          });
        }
        return { job: existing, replayed: true };
      }
    }
    throw err;
  }
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

  await prisma.$transaction(async (tx) => {
    await lockSmartExportJob(tx, assignment.jobId);
    const transitioned = await tx.smartExportAssignment.updateMany({
      where: { id: assignmentId, status: "failed" },
      data: { status: "pending", error: null, uploadLeaseId: null, uploadHeartbeatAt: null },
    });
    if (transitioned.count === 0) {
      throw new SmartExportRequestConflictError("Assignment changed before it could be retried");
    }
    await tx.smartExportJob.update({
      where: { id: assignment.jobId },
      data: { status: "uploading" },
    });
    const reserved = await tx.multiplierOutput.updateMany({
      where: { id: assignment.videoId, exportStatus: "not_exported" },
      data: { exportStatus: "exporting" },
    });
    if (reserved.count !== 1) {
      throw new SmartExportRequestConflictError(
        "Video is already reserved or exported by another job. Refresh and try again."
      );
    }
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
const EXPORT_HEARTBEAT_MS = 30_000;

function staleUploadingWhere(staleBefore: Date): Prisma.SmartExportAssignmentWhereInput {
  return {
    status: "uploading",
    OR: [
      { uploadHeartbeatAt: { lt: staleBefore } },
      { uploadHeartbeatAt: null, updatedAt: { lt: staleBefore } },
    ],
  };
}

function freshUploadingWhere(staleBefore: Date): Prisma.SmartExportAssignmentWhereInput {
  return {
    status: "uploading",
    OR: [
      { uploadHeartbeatAt: { gte: staleBefore } },
      { uploadHeartbeatAt: null, updatedAt: { gte: staleBefore } },
    ],
  };
}

async function lockSmartExportJob(tx: Prisma.TransactionClient, jobId: string) {
  const jobs = await tx.$queryRaw<Array<{ id: string; status: string }>>`
    SELECT id, status
    FROM "SmartExportJob"
    WHERE id = ${jobId}
    FOR UPDATE
  `;
  const job = jobs[0];
  if (!job) throw new Error("Smart Export Job not found");
  return job;
}

function startExportHeartbeat(assignmentId: string, leaseId: string): () => void {
  const beat = () => {
    prisma.smartExportAssignment.updateMany({
      where: { id: assignmentId, status: "uploading", uploadLeaseId: leaseId },
      data: { uploadHeartbeatAt: new Date() },
    }).catch((err) => {
      console.error(`[Smart Export Worker] Heartbeat failed for assignment ${assignmentId}:`, err);
    });
  };
  const timer = setInterval(beat, EXPORT_HEARTBEAT_MS);
  timer.unref();
  return () => clearInterval(timer);
}

/**
 * True when an upload failure is the master Google account's Drive storage
 * quota being exhausted — a job-fatal condition: every remaining upload will
 * fail the same way, so the job gets paused instead of burning through.
 * Matches the raw googleapis error shape and the "Auth error (403): ..."
 * string uploadWithRetry wraps it in.
 */
function hasDriveRateLimitReason(reasons: string[], codes: string[]): boolean {
  return [...reasons, ...codes].some((value) => /^(rateLimitExceeded|userRateLimitExceeded)$/i.test(value));
}

export function isDriveQuotaError(err: unknown): boolean {
  const { message, reasons, codes } = driveErrorDetails(err);
  if (hasDriveRateLimitReason(reasons, codes)) return false;
  if (/storage.?quota/i.test(message)) return true;
  return [...reasons, ...codes].some((value) => /storage.?quota/i.test(value));
}

/**
 * Pause a job whose uploads are failing on Drive storage quota. Still-pending
 * assignments stay pending so a later retry resumes cleanly. The job row lock
 * serializes pauses with retries and finalization.
 */
async function pauseJobForQuota(jobId: string, reason: string) {
  const pendingCount = await prisma.$transaction(async (tx) => {
    const job = await lockSmartExportJob(tx, jobId);
    if (job.status !== "pending" && job.status !== "uploading") return null;

    const grouped = await tx.smartExportAssignment.groupBy({
      by: ["status"],
      where: { jobId },
      _count: true,
    });
    let successCount = 0;
    let failedCount = 0;
    let pendingCount = 0;
    for (const row of grouped) {
      if (row.status === "done") successCount = row._count;
      else if (row.status === "failed") failedCount = row._count;
      else pendingCount += row._count;
    }

    await tx.smartExportJob.update({
      where: { id: jobId },
      data: {
        status: "paused_quota",
        summary: {
          total: successCount + failedCount + pendingCount,
          successCount,
          failedCount,
          pendingCount,
          pausedAt: new Date().toISOString(),
          pauseReason: reason,
        },
      },
    });
    return pendingCount;
  });
  if (pendingCount !== null) {
    console.warn(
      `[Smart Export Worker] Job ${jobId} paused — Drive storage quota exceeded (${reason}). ` +
        `${pendingCount} assignment(s) left pending; free space on the master Google account, then retry the job.`
    );
  }
}

let isExportWorkerRunning = false;
let exportWorkerRestartRequested = false;

export async function triggerSmartExportWorker() {
  if (isExportWorkerRunning) {
    exportWorkerRestartRequested = true;
    return;
  }
  isExportWorkerRunning = true;
  exportWorkerRestartRequested = false;
  processExportQueue()
    .catch((err) => {
      // Last-resort guard: the loop body is individually hardened, but a
      // throw here must never become an unhandled rejection.
      console.error("[Smart Export Worker] Queue processing crashed:", err);
    })
    .finally(() => {
      isExportWorkerRunning = false;
      if (exportWorkerRestartRequested) {
        exportWorkerRestartRequested = false;
        triggerSmartExportWorker().catch((err) => {
          console.error("[Smart Export Worker] Failed to restart requested queue pass:", err);
        });
      }
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
    where: staleUploadingWhere(staleBefore),
    data: { status: "pending", error: null, uploadLeaseId: null, uploadHeartbeatAt: null },
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
  const staleBefore = new Date(Date.now() - STALE_UPLOADING_MINUTES * 60 * 1000);
  const { shouldRun, ...result } = await prisma.$transaction(async (tx) => {
    await lockSmartExportJob(tx, jobId);
    const requeueable = await tx.smartExportAssignment.findMany({
      where: {
        jobId,
        OR: [{ status: "failed" }, staleUploadingWhere(staleBefore)],
      },
      select: { id: true, status: true, videoId: true },
    });
    const requeuedFailed = requeueable.filter((a) => a.status === "failed").length;
    const requeuedStaleUploading = requeueable.length - requeuedFailed;

    if (requeueable.length > 0) {
      const transitioned = await tx.smartExportAssignment.updateMany({
        where: {
          jobId,
          id: { in: requeueable.map((a) => a.id) },
          OR: [{ status: "failed" }, staleUploadingWhere(staleBefore)],
        },
        data: { status: "pending", error: null, uploadLeaseId: null, uploadHeartbeatAt: null },
      });
      if (transitioned.count !== requeueable.length) {
        throw new SmartExportRequestConflictError("Job changed while it was being retried. Refresh and try again.");
      }
      const failedVideoIds = [...new Set(
        requeueable.filter((a) => a.status === "failed").map((a) => a.videoId)
      )];
      const staleVideoIds = [...new Set(
        requeueable.filter((a) => a.status === "uploading").map((a) => a.videoId)
      )];
      const failedReserved = await tx.multiplierOutput.updateMany({
        where: { id: { in: failedVideoIds }, exportStatus: "not_exported" },
        data: { exportStatus: "exporting" },
      });
      const staleReserved = await tx.multiplierOutput.updateMany({
        where: { id: { in: staleVideoIds }, exportStatus: { in: ["exporting", "not_exported"] } },
        data: { exportStatus: "exporting" },
      });
      if (failedReserved.count !== failedVideoIds.length || staleReserved.count !== staleVideoIds.length) {
        throw new SmartExportRequestConflictError(
          "Some videos are already reserved or exported by another job. Refresh and try again."
        );
      }
    }

    const pendingTotal = await tx.smartExportAssignment.count({
      where: { jobId, status: "pending" },
    });
    const openTotal = await tx.smartExportAssignment.count({
      where: { jobId, status: { in: ["pending", "uploading"] } },
    });
    const shouldRun = openTotal > 0;
    if (shouldRun) {
      await tx.smartExportJob.update({
        where: { id: jobId },
        data: { status: "uploading" },
      });
    }
    return { requeuedFailed, requeuedStaleUploading, pendingTotal, shouldRun };
  });

  if (shouldRun) {
    triggerSmartExportWorker().catch((err) => {
      console.error("[Smart Export Service] Failed to trigger background worker on job resume:", err);
    });
  }

  return result;
}

/**
 * Job-level retry used by POST /api/multiplier/smart-export/jobs/[id]/retry.
 * Requeues failed (error cleared) + stale "uploading" assignments as pending,
 * resets the job to "pending" (clears failed/paused_quota), and retriggers the
 * worker. Refuses while a worker is actively uploading this job's files — a
 * fresh "uploading" row means a live worker holds it. Also resumes jobs stuck
 * in "pending" from a dead queue (requeued may be 0 — the worker kick is the
 * point).
 */
export async function retrySmartExportJob(jobId: string): Promise<{ requeued: number }> {
  const staleBefore = new Date(Date.now() - STALE_UPLOADING_MINUTES * 60 * 1000);
  const requeued = await prisma.$transaction(async (tx) => {
    const job = await lockSmartExportJob(tx, jobId);
    const activeUploads = await tx.smartExportAssignment.count({
      where: { jobId, ...freshUploadingWhere(staleBefore) },
    });
    if (job.status === "uploading" && activeUploads > 0) {
      throw new Error("Job is currently processing");
    }

    const requeueable = await tx.smartExportAssignment.findMany({
      where: {
        jobId,
        OR: [{ status: "failed" }, staleUploadingWhere(staleBefore)],
      },
      select: { id: true, status: true, videoId: true },
    });

    if (requeueable.length > 0) {
      const transitioned = await tx.smartExportAssignment.updateMany({
        where: {
          jobId,
          id: { in: requeueable.map((a) => a.id) },
          OR: [{ status: "failed" }, staleUploadingWhere(staleBefore)],
        },
        data: { status: "pending", error: null, uploadLeaseId: null, uploadHeartbeatAt: null },
      });
      if (transitioned.count !== requeueable.length) {
        throw new SmartExportRequestConflictError("Job changed while it was being retried. Refresh and try again.");
      }
      const failedVideoIds = [...new Set(
        requeueable.filter((a) => a.status === "failed").map((a) => a.videoId)
      )];
      const staleVideoIds = [...new Set(
        requeueable.filter((a) => a.status === "uploading").map((a) => a.videoId)
      )];
      const failedReserved = await tx.multiplierOutput.updateMany({
        where: { id: { in: failedVideoIds }, exportStatus: "not_exported" },
        data: { exportStatus: "exporting" },
      });
      const staleReserved = await tx.multiplierOutput.updateMany({
        where: { id: { in: staleVideoIds }, exportStatus: { in: ["exporting", "not_exported"] } },
        data: { exportStatus: "exporting" },
      });
      if (failedReserved.count !== failedVideoIds.length || staleReserved.count !== staleVideoIds.length) {
        throw new SmartExportRequestConflictError(
          "Some videos are already reserved or exported by another job. Refresh and try again."
        );
      }
    }

    await tx.smartExportJob.update({
      where: { id: jobId },
      data: { status: "pending" },
    });
    return requeueable.length;
  });

  triggerSmartExportWorker().catch((err) => {
    console.error("[Smart Export Service] Failed to trigger background worker on job retry:", err);
  });

  return { requeued };
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

// Uploads are network-bound and stream from/to disk, so they can use more
// lanes than CPU-bound renders. Dynamic admission limits active claims while
// the physical pool remains sized for the largest env/preset limit.

const assignmentClaimInclude = {
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
} as const;

/**
 * Atomically claim the next pending assignment.
 * Returns the claimed assignment, "lost" when another worker won the race
 * (caller retries immediately), or null when the queue is empty.
 * The claim is a conditional updateMany — two workers may read the same
 * candidate id, but only one transition pending → uploading succeeds.
 */
async function claimNextAssignment() {
  // Jobs paused on Drive quota are skipped at candidate selection so their
  // assignments stay pending for a later retry.
  const candidate = await prisma.smartExportAssignment.findFirst({
    where: { status: "pending", job: { status: { notIn: ["paused_quota"] } } },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  if (!candidate) return null;

  const uploadLeaseId = randomUUID();
  const claim = await prisma.smartExportAssignment.updateMany({
    where: { id: candidate.id, status: "pending" },
    data: { status: "uploading", uploadLeaseId, uploadHeartbeatAt: new Date() },
  });
  if (claim.count === 0) return "lost";

  const assignment = await prisma.smartExportAssignment.findUnique({
    where: { id: candidate.id },
    include: assignmentClaimInclude,
  });
  // Row vanished between claim and fetch (e.g. cascade delete) — treat as lost.
  if (!assignment || assignment.uploadLeaseId !== uploadLeaseId) return "lost";

  // The job may have been paused for quota between candidate read and claim —
  // release the claim back to pending and treat as lost (the candidate filter
  // above excludes it on the next pass).
  if (assignment.job.status === "paused_quota") {
    await prisma.smartExportAssignment.updateMany({
      where: { id: assignment.id, status: "uploading", uploadLeaseId },
      data: { status: "pending", uploadLeaseId: null, uploadHeartbeatAt: null },
    });
    return "lost";
  }

  // Update parent job status to uploading if it was pending
  if (assignment.job.status === "pending") {
    await prisma.smartExportJob.updateMany({
      where: { id: assignment.jobId, status: "pending" },
      data: { status: "uploading" },
    });
  }

  return { ...assignment, uploadLeaseId };
}

async function processExportQueue() {
  await getMultiplierPerformanceState().catch((err) => {
    console.error("[Smart Export Worker] Performance settings load failed; using cached limits:", err);
  });
  console.log(
    `[Smart Export Worker] Starting processing queue ` +
    `with ${exportAdmissionController.getMetrics().limit} active lanes ` +
    `(pool ${EXPORT_ADMISSION_POOL_LIMIT})...`
  );

  await Promise.all(
    Array.from({ length: EXPORT_ADMISSION_POOL_LIMIT }, (_, i) => workerLoop(i))
  );

  // Queue drained — finalize any job whose status flip was lost to a crash.
  await finalizeDrainedJobs().catch((err) => {
    console.error("[Smart Export Worker] Drained-job finalization failed:", err);
  });
}

async function workerLoop(workerIndex: number) {
  while (true) {
    const releaseAdmission = await exportAdmissionController.acquire();
    try {
      // Claim the next pending assignment. A throw here is almost
      // certainly the DB itself — stop this worker (the cron/boot resume
      // re-triggers the pool) instead of hot-looping on the same row.
      let assignment;
      try {
        const claimed = await claimNextAssignment();
        if (claimed === null) {
          console.log(`[Smart Export Worker ${workerIndex}] Queue empty. Going to sleep.`);
          break;
        }
        if (claimed === "lost") {
          // Another worker claimed it first — retry immediately, no sleep.
          continue;
        }
        assignment = claimed;
      } catch (err) {
        console.error(
          `[Smart Export Worker ${workerIndex}] Queue fetch/claim failed — stopping worker (cron resume will retrigger):`,
          err
        );
        break;
      }

      const stopHeartbeat = startExportHeartbeat(assignment.id, assignment.uploadLeaseId);
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
          const downloaded = await downloadFromR2(key, localFilePath);
          if (!downloaded) throw new Error(`Could not download video from storage: ${key}`);
        }

        if (!fs.existsSync(localFilePath)) {
          throw new Error(`Video file does not exist on disk or storage: ${video.outputRef}`);
        }

        // 2. Fetch Drive client (cached per worker — the client identity is the
        // single Drive-connected account, identical for every file in the queue,
        // hence the constant cache key)
        const drive = await getCachedMultiplierDriveClient("export-worker");
        if (!drive) {
          throw new Error("Google Drive connection is not connected. Please connect Drive first.");
        }

        // 3. Upload to Google Drive
        const campaignTitle: string | null =
          video.group?.campaign?.title || video.group?.campaign?.name || null;
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
        // Hooks-off bulk mode leaves the hook text empty — "plain" keeps the
        // <campaign>_<slug>_<outputId>.mp4 shape the posting pipeline parses.
        const fileName = `${campaignPrefix}${cleanCampaignSlug}_${cleanHookSlug || "plain"}_${video.id}.mp4`;

        console.log(`[Smart Export Worker] Uploading ${fileName} to folder ${assignment.driveFolderId}`);
        const uploadResult = await uploadWithRetry(drive, localFilePath, fileName, assignment.driveFolderId);
        if (!uploadResult.success) {
          throw new Error(uploadResult.error || "Drive upload failed", { cause: uploadResult.cause });
        }

        // 4. Mark success
        const groupCampaignId: string | null = video.group?.campaignId || null;
        const feedAccount = await prisma.managedAccount.findFirst({
          where: { driveFolderId: assignment.driveFolderId },
          select: { id: true },
        });
        const completed = await prisma.$transaction(async (tx) => {
          const transitioned = await tx.smartExportAssignment.updateMany({
            where: { id: assignment.id, status: "uploading", uploadLeaseId: assignment.uploadLeaseId },
            data: { status: "done", error: null, uploadLeaseId: null, uploadHeartbeatAt: null },
          });
          if (transitioned.count === 0) return false;

          await tx.accountFeedEvent.create({
            data: {
              accountId: feedAccount?.id ?? null,
              driveFolderId: assignment.driveFolderId,
              source: "smart_export",
            },
          });
          await tx.multiplierOutput.update({
            where: { id: video.id },
            data: {
              exportStatus: "exported",
              exportedAt: new Date(),
              exportDestinationFolderId: assignment.driveFolderId,
            },
          });
          if (groupCampaignId) {
            await tx.campaign.update({
              where: { id: groupCampaignId },
              data: { exportedCount: { increment: 1 } },
            });
            await tx.campaignEvent.create({
              data: {
                campaignId: groupCampaignId,
                type: "export",
                meta: {
                  driveFolderId: assignment.driveFolderId,
                  groupId: video.groupId,
                  groupName: video.group?.name || null,
                  jobId: assignment.jobId,
                },
              },
            });
          }
          return true;
        });

        if (completed) {
          console.log(`[Smart Export Worker] Upload complete for assignment: ${assignment.id}`);
        } else {
          console.warn(`[Smart Export Worker] Ignoring stale completion for assignment: ${assignment.id}`);
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[Smart Export Worker] Assignment ${assignment.id} failed:`, errMsg);

        let markedFailed = false;
        try {
          markedFailed = await prisma.$transaction(async (tx) => {
            const transitioned = await tx.smartExportAssignment.updateMany({
              where: { id: assignment.id, status: "uploading", uploadLeaseId: assignment.uploadLeaseId },
              data: { status: "failed", error: errMsg, uploadLeaseId: null, uploadHeartbeatAt: null },
            });
            if (transitioned.count === 0) return false;
            await tx.multiplierOutput.updateMany({
              where: { id: assignment.videoId, exportStatus: "exporting" },
              data: { exportStatus: "not_exported" },
            });
            return true;
          });
        } catch (markErr) {
          console.error(
            `[Smart Export Worker] Failed to mark assignment ${assignment.id} as failed:`,
            markErr
          );
        }

        if (markedFailed && isDriveQuotaError(err)) {
          await pauseJobForQuota(assignment.jobId, errMsg).catch((pauseErr) => {
            console.error(
              `[Smart Export Worker] Failed to pause job ${assignment.jobId} after quota error:`,
              pauseErr
            );
          });
        }
      } finally {
        stopHeartbeat();
      }

      // Update parent job status check
      await updateParentJobStatus(assignment.jobId).catch((err) => {
        console.error(`[Smart Export Worker] Parent status update failed for job ${assignment.jobId}:`, err);
      });
    } finally {
      releaseAdmission();
    }
  }
}

async function updateParentJobStatus(jobId: string) {
  await prisma.$transaction(async (tx) => {
    const job = await lockSmartExportJob(tx, jobId);
    if (job.status !== "pending" && job.status !== "uploading") return;

    const unfinished = await tx.smartExportAssignment.findFirst({
      where: { jobId, status: { in: ["pending", "uploading"] } },
      select: { id: true },
    });
    if (unfinished) return;

    const grouped = await tx.smartExportAssignment.groupBy({
      by: ["status"],
      where: { jobId },
      _count: true,
    });

    let successCount = 0;
    let failedCount = 0;
    let unfinishedCount = 0;
    for (const row of grouped) {
      if (row.status === "done") successCount = row._count;
      else if (row.status === "failed") failedCount = row._count;
      else unfinishedCount += row._count;
    }
    if (unfinishedCount > 0) return;

    // Partial success is DONE with failures — only a job where nothing
    // uploaded at all counts as failed.
    const finalStatus = failedCount > 0 && successCount === 0 ? "failed" : "done";
    const summary = {
      total: successCount + failedCount,
      successCount,
      failedCount,
      completedAt: new Date().toISOString(),
    };

    await tx.smartExportJob.updateMany({
      where: { id: jobId, status: { in: ["pending", "uploading"] } },
      data: {
        status: finalStatus,
        summary,
      },
    });
  });
}

// Builds the "(Campaign Title) " filename prefix. Keeps the full human-readable
// title (spaces intact) and only strips characters illegal in Drive file names.
export function formatCampaignBracketPrefix(campaignTitle: string): string {
  const safeTitle = campaignTitle.replace(/[/\\]/g, " ").replace(/\s+/g, " ").trim();
  return safeTitle ? `(${safeTitle}) ` : "";
}

// Finds a file with the exact same name already sitting in the target folder.
async function findExistingDriveFile(
  drive: SmartExportDriveClient,
  fileName: string,
  folderId: string
): Promise<string | null> {
  const escapedName = fileName.replace(/'/g, "\\'");
  await smartExportDriveRequestPacer.beforeRequest();
  const res = await drive.files.list({
    q: `name = '${escapedName}' and '${folderId}' in parents and trashed = false`,
    fields: "files(id,name)",
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return res.data.files?.[0]?.id || null;
}

interface DriveErrorShape {
  code?: unknown;
  name?: unknown;
  status?: unknown;
  message?: unknown;
  cause?: unknown;
  response?: {
    status?: unknown;
    headers?: unknown;
    data?: {
      error?: {
        message?: unknown;
        errors?: unknown;
      };
    };
  };
}

function driveErrorChain(err: unknown): DriveErrorShape[] {
  const chain: DriveErrorShape[] = [];
  const seen = new Set<unknown>();
  let current = err;
  while (typeof current === "object" && current !== null && !seen.has(current) && chain.length < 4) {
    seen.add(current);
    const shape = current as DriveErrorShape;
    chain.push(shape);
    current = shape.cause;
  }
  return chain;
}

function driveErrorDetails(err: unknown) {
  const chain = driveErrorChain(err);
  let status: number | undefined;
  for (const error of chain) {
    const numericStatus = Number(error.response?.status ?? error.status ?? error.code);
    if (Number.isFinite(numericStatus) && numericStatus >= 100) {
      status = numericStatus;
      break;
    }
  }

  const responseMessage = chain
    .map((error) => error.response?.data?.error?.message)
    .find((value) => typeof value === "string" && value.length > 0);
  const directMessage = chain
    .map((error) => error.message)
    .find((value) => typeof value === "string" && value.length > 0);
  const messageValue = responseMessage ?? directMessage;
  const message = messageValue ? String(messageValue) : String(err);

  const reasons = chain.flatMap((error) => {
    const errors = error.response?.data?.error?.errors;
    if (!Array.isArray(errors)) return [];
    return errors.flatMap((item) => {
      if (typeof item !== "object" || item === null || !("reason" in item)) return [];
      const reason = String(item.reason ?? "");
      return reason ? [reason] : [];
    });
  });
  const codes = chain
    .flatMap((error) => [error.code, error.name])
    .filter((value): value is string | number => typeof value === "string" || typeof value === "number")
    .map(String);

  return { status, message, reasons, codes };
}

function isDriveRateLimitError(err: unknown): boolean {
  const { status, reasons, codes } = driveErrorDetails(err);
  return status === 429 || (status === 403 && hasDriveRateLimitReason(reasons, codes));
}

export function isRetryableDriveError(err: unknown): boolean {
  if (isDriveQuotaError(err)) return false;
  const { status, reasons, codes, message } = driveErrorDetails(err);
  if (status === 403) {
    return hasDriveRateLimitReason(reasons, codes);
  }
  if (status !== undefined) {
    return status === 408 || status === 429 || (status >= 500 && status <= 599);
  }

  const retryableCodes = new Set([
    "ECONNRESET",
    "ECONNREFUSED",
    "ECONNABORTED",
    "ETIMEDOUT",
    "EAI_AGAIN",
    "ENETUNREACH",
    "EHOSTUNREACH",
    "ENOTFOUND",
    "EPIPE",
    "ERR_NETWORK",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_SOCKET",
    "TIMEOUTERROR",
  ]);
  return codes.some((code) => retryableCodes.has(code.toUpperCase())) ||
    /^fetch failed$/i.test(message) ||
    /socket hang up|network socket disconnected/i.test(message);
}

function retryAfterMs(err: unknown): number {
  for (const error of driveErrorChain(err)) {
    const headers = error.response?.headers;
    if (typeof headers !== "object" || headers === null) continue;

    let value: unknown;
    if (typeof (headers as { get?: unknown }).get === "function") {
      value = (headers as { get: (name: string) => unknown }).get("retry-after");
    } else {
      const record = headers as Record<string, unknown>;
      value = record["retry-after"] ?? record["Retry-After"];
    }
    if (Array.isArray(value)) value = value[0];
    if (value === undefined || value === null || value === "") continue;

    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, Math.min(120_000, seconds * 1000));
    const date = Date.parse(String(value));
    return Number.isNaN(date) ? 0 : Math.max(0, Math.min(120_000, date - Date.now()));
  }
  return 0;
}

export function getDriveRetryDelayMs(err: unknown, attempt: number): number {
  const safeAttempt = Number.isFinite(attempt) ? Math.max(1, Math.floor(attempt)) : 1;
  const cap = Math.min(30_000, 1000 * 2 ** (safeAttempt - 1));
  const jitter = 250 + Math.floor(Math.random() * Math.max(1, cap - 250));
  return Math.max(jitter, retryAfterMs(err));
}

export async function uploadWithRetry(
  drive: SmartExportDriveClient,
  filePath: string,
  fileName: string,
  folderId: string,
  maxRetries = 5
): Promise<{ success: boolean; fileId?: string; error?: string; cause?: unknown }> {
  let lastError = "Drive upload failed";
  let lastCause: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const existingId = await findExistingDriveFile(drive, fileName, folderId);
      if (existingId) {
        console.log(`[Smart Export Drive] Dedup hit: "${fileName}" already exists in folder ${folderId} (file id: ${existingId}) — skipping re-upload`);
        return { success: true, fileId: existingId };
      }

      await smartExportDriveRequestPacer.beforeRequest();
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
      return { success: true, fileId: res.data.id ?? undefined };
    } catch (err: unknown) {
      const { status, message } = driveErrorDetails(err);
      lastError = message;
      lastCause = err;
      if (!isRetryableDriveError(err)) {
        const prefix = status === 401 || status === 403 ? `Auth error (${status}): ` : "";
        return { success: false, error: `${prefix}${message}`, cause: err };
      }

      const backoff = getDriveRetryDelayMs(err, attempt);
      if (isDriveRateLimitError(err)) {
        smartExportDriveRequestPacer.noteRateLimit(backoff);
      }
      console.warn(`[Smart Export Drive] Upload attempt ${attempt}/${maxRetries} failed: ${message}`);
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }
  return { success: false, error: `Failed after ${maxRetries} attempts: ${lastError}`, cause: lastCause };
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


export const EXPORT_WARMUP_MIN_AGE_DAYS = 3;

/**
 * Smart-select for the Smart Export account picker.
 * Returns ManagedAccount ids that pass every gate:
 *  - base: isActive + driveConnected + driveFolderId + postpeerAccountId (optionally section-scoped)
 *  - warmup: createdAt older than EXPORT_WARMUP_MIN_AGE_DAYS (new accounts warm up first)
 *  - not banned: sweepNotFoundStreak < 2 and color != 'red'
 *  - recently published: >=1 PostJob in a terminal-published state with publishedAt within postedWithinDays
 *  - not dead-reach: >=1 captured TrackedVideo published within zeroViewDays with views > 0
 * `considered` = accounts passing the base gates before the post/view/ban filters.
 */
export async function getSmartSelectAccounts(opts: {
  sectionIds?: string[];
  postedWithinDays?: number;
  zeroViewDays?: number;
}) {
  const postedWithinDays = Math.max(1, Math.floor(opts.postedWithinDays ?? 10) || 10);
  const zeroViewDays = Math.max(1, Math.floor(opts.zeroViewDays ?? 4) || 4);
  const now = Date.now();
  const postedSince = new Date(now - postedWithinDays * 24 * 60 * 60 * 1000);
  const viewsSince = new Date(now - zeroViewDays * 24 * 60 * 60 * 1000);

  const sectionIds = (opts.sectionIds || []).filter(Boolean);

  // Base gates
  const accounts = await prisma.managedAccount.findMany({
    where: {
      isActive: true,
      driveConnected: true,
      driveFolderId: { not: null },
      postpeerAccountId: { not: null },
      createdAt: { lte: new Date(now - EXPORT_WARMUP_MIN_AGE_DAYS * 24 * 60 * 60 * 1000) },
      ...(sectionIds.length > 0 ? { sectionId: { in: sectionIds } } : {}),
    },
    select: { id: true, sectionId: true, sweepNotFoundStreak: true, color: true },
  });

  const considered = accounts.length;
  if (considered === 0) return { accountIds: [] as string[], matched: 0, considered };

  // Banned accounts are excluded before the post/view lookups
  const eligibleIds = accounts
    .filter((a) => a.sweepNotFoundStreak < 2 && (a.color || "").toLowerCase() !== "red")
    .map((a) => a.id);
  if (eligibleIds.length === 0) return { accountIds: [] as string[], matched: 0, considered };

  // Recent publishers: >=1 terminal-published PostJob within the window
  const recentJobs = await prisma.postJob.groupBy({
    by: ["accountId"],
    where: {
      accountId: { in: eligibleIds },
      state: { in: ["PUBLISHED", "PENDING_DELETION", "DELETED"] },
      publishedAt: { gte: postedSince },
    },
  });
  const publisherIds = new Set(recentJobs.map((j) => j.accountId));

  // Live reach: >=1 captured TrackedVideo in the window with views > 0
  const recentVideos = await prisma.trackedVideo.findMany({
    where: {
      accountId: { in: eligibleIds },
      status: "captured",
      publishedAt: { gte: viewsSince },
      views: { gt: BigInt(0) },
    },
    select: { accountId: true },
    distinct: ["accountId"],
  });
  const liveReachIds = new Set(recentVideos.map((v) => v.accountId));

  const accountIds = eligibleIds.filter((id) => publisherIds.has(id) && liveReachIds.has(id));

  return { accountIds, matched: accountIds.length, considered };
}


export type ExportWarmupStatus = "warming" | "test_due" | "verified" | "failed" | "stalled";

export interface ExportWarmupAccount {
  id: string;
  name: string;
  driveFolderId: string | null;
  sectionId: string;
  color: string | null;
  createdAt: string;
  ageDays: number;
  ageHours: number;
  status: ExportWarmupStatus;
  eligible: boolean;
  blockedReason: "warmup" | "test_post_failed" | "never_posted" | "banned" | "not_connected" | null;
  firstPostAt: string | null;
  lastPostAt: string | null;
  publishedCount: number;
  failedCount: number;
  /** Graduated = we've selected this account in an export and fed videos into its
   *  Drive (AccountFeedEvent). Graduated accounts leave the warm-up list and are
   *  managed as normal accounts. Age alone does NOT graduate an account. */
  graduated: boolean;
  /** First time we fed videos into this account's Drive (null if never). */
  firstFedAt: string | null;
}

/**
 * Warm-up status for newly created ManagedAccounts in the export pipeline.
 * Accounts within the age window (default: 0..14 days) are listed with a status
 * derived from ManagedAccount.createdAt + PostJob history (no schema state):
 *  - "verified": has >=1 terminal-published PostJob (test post landed). Selectable
 *    ("ready") once older than EXPORT_WARMUP_MIN_AGE_DAYS, passing the base export
 *    gates (connected, not banned) AND not yet graduated. Graduation is NOT
 *    age-based: an account graduates only once an export feeds videos into its
 *    Drive (AccountFeedEvent), after which it leaves this list and is managed as
 *    a normal account.
 *  - "failed":   no publish yet but >=1 terminally FAILED PostJob — flag for review.
 *  - "stalled":  3+ days old, never attempted a post.
 *  - "test_due": 2-3 days old, no posts yet — the day-2 test post should happen now.
 *  - "warming":  under 2 days old, no posts yet.
 */
export async function getExportWarmupAccounts(opts: {
  sectionIds?: string[];
  minAgeDays?: number;
  maxAgeDays?: number;
  /** Include graduated accounts (3+ days old AND posting) in the list. Default false —
   *  the warm-up tab is only for accounts still warming up or not posting yet. */
  includeGraduated?: boolean;
}) {
  const minAgeDays = Math.max(0, Math.floor(opts.minAgeDays ?? 0) || 0);
  const maxAgeDays = Math.min(60, Math.max(1, Math.floor(opts.maxAgeDays ?? 14) || 14));
  const now = Date.now();
  const createdAfter = new Date(now - maxAgeDays * 24 * 60 * 60 * 1000);
  const createdBefore = new Date(now - minAgeDays * 24 * 60 * 60 * 1000);

  const sectionIds = (opts.sectionIds || []).filter(Boolean);

  const accounts = await prisma.managedAccount.findMany({
    where: {
      isActive: true,
      createdAt: { gte: createdAfter, lte: createdBefore },
      ...(sectionIds.length > 0 ? { sectionId: { in: sectionIds } } : {}),
    },
    select: {
      id: true,
      tiktokUsername: true,
      tiktokDisplayName: true,
      driveFolderId: true,
      sectionId: true,
      color: true,
      createdAt: true,
      driveConnected: true,
      postpeerAccountId: true,
      sweepNotFoundStreak: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const accountIds = accounts.map((a) => a.id);
  const [publishedJobs, failedJobs, feedEvents] = accountIds.length > 0
    ? await Promise.all([
        prisma.postJob.groupBy({
          by: ["accountId"],
          where: {
            accountId: { in: accountIds },
            state: { in: ["PUBLISHED", "PENDING_DELETION", "DELETED"] },
          },
          _count: { _all: true },
          _min: { publishedAt: true },
          _max: { publishedAt: true },
        }),
        prisma.postJob.groupBy({
          by: ["accountId"],
          where: { accountId: { in: accountIds }, state: "FAILED" },
          _count: { _all: true },
        }),
        // Graduation signal: we selected this account in an export and fed
        // videos into its Drive at least once.
        prisma.accountFeedEvent.groupBy({
          by: ["accountId"],
          where: { accountId: { in: accountIds } },
          _count: { _all: true },
          _min: { createdAt: true },
        }),
      ])
    : [[], [], []];

  const publishedByAccount = new Map(
    publishedJobs.map((j) => [
      j.accountId,
      { count: j._count._all, firstPostAt: j._min.publishedAt, lastPostAt: j._max.publishedAt },
    ]),
  );
  const failedByAccount = new Map(failedJobs.map((j) => [j.accountId, j._count._all]));
  const fedByAccount = new Map(
    feedEvents.map((e) => [e.accountId, { count: e._count._all, firstFedAt: e._min.createdAt }]),
  );

  const warmupMs = EXPORT_WARMUP_MIN_AGE_DAYS * 24 * 60 * 60 * 1000;

  const result: ExportWarmupAccount[] = accounts.map((a) => {
    const ageMs = now - a.createdAt.getTime();
    const hours = ageMs / 3.6e6;
    const published = publishedByAccount.get(a.id);
    const publishedCount = published?.count ?? 0;
    const failedCount = failedByAccount.get(a.id) ?? 0;
    const fed = fedByAccount.get(a.id);
    const graduated = (fed?.count ?? 0) >= 1;

    let status: ExportWarmupStatus;
    let eligible = false;
    let blockedReason: ExportWarmupAccount["blockedReason"] = null;

    if (publishedCount >= 1) {
      status = "verified";
      const banned = a.sweepNotFoundStreak >= 2 || (a.color || "").toLowerCase() === "red";
      const connected = a.driveConnected && a.driveFolderId != null && a.postpeerAccountId != null;
      if (banned) {
        blockedReason = "banned";
      } else if (!connected) {
        blockedReason = "not_connected";
      } else if (ageMs < warmupMs) {
        blockedReason = "warmup";
      } else if (graduated) {
        // Already fed by an export — a normal account now, not selectable here.
        blockedReason = null;
      } else {
        eligible = true;
      }
    } else if (failedCount >= 1) {
      status = "failed";
      blockedReason = "test_post_failed";
    } else if (hours >= 72) {
      status = "stalled";
      blockedReason = "never_posted";
    } else if (hours >= 48) {
      status = "test_due";
      blockedReason = "warmup";
    } else {
      status = "warming";
      blockedReason = "warmup";
    }

    return {
      id: a.id,
      name: a.tiktokDisplayName || a.tiktokUsername,
      driveFolderId: a.driveFolderId,
      sectionId: a.sectionId,
      color: a.color ?? null,
      createdAt: a.createdAt.toISOString(),
      ageDays: Math.floor(hours / 24),
      ageHours: Math.floor(hours),
      status,
      eligible,
      blockedReason,
      firstPostAt: published?.firstPostAt ? published.firstPostAt.toISOString() : null,
      lastPostAt: published?.lastPostAt ? published.lastPostAt.toISOString() : null,
      publishedCount,
      failedCount,
      graduated,
      firstFedAt: fed?.firstFedAt ? fed.firstFedAt.toISOString() : null,
    };
  });

  const counts = {
    warming: 0,
    test_due: 0,
    verified: 0,
    failed: 0,
    stalled: 0,
    eligible: 0,
    graduated: 0,
  };
  for (const a of result) {
    counts[a.status] += 1;
    if (a.eligible) counts.eligible += 1;
    if (a.graduated) counts.graduated += 1;
  }

  // Graduated accounts (already fed videos via an export) are normal accounts now —
  // they leave the warm-up list unless explicitly requested.
  const visible = opts.includeGraduated ? result : result.filter((a) => !a.graduated);

  return { warmupMinAgeDays: EXPORT_WARMUP_MIN_AGE_DAYS, accounts: visible, counts };
}
