// Bulk Link Sourcing service: paste TikTok links → background download (via
// Apify — yt-dlp is IP-blocked by TikTok) → distribute to account Drive
// folders → delete local temp files.
//
// Downloads and uploads run in in-process background workers (never in the
// request path), mirroring the multiplier/factory pattern: a module-level lock
// plus atomic status-flip claiming so two workers never grab the same item.

import fs from "fs";
import path from "path";
import prisma from "@/lib/db";
import { getDriveClient, uploadFileToFolder } from "@/lib/google";
import { downloadTikTokVideo, TikTokDownloadError } from "@/lib/services/tiktok-download";
import {
  parseLinksPure,
  buildDistributionPlan,
  type ParseLinksResult,
  type PlanAccount,
  type DistributionPlanResult,
} from "@/lib/services/sourcing-pure";

const TEMP_DIR = path.join(process.cwd(), "public", "uploads", "sourcing", "temp");

// Concurrency is configurable via env; defaults match the multiplier worker (2).
const DOWNLOAD_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.SOURCING_DOWNLOAD_CONCURRENCY || "2", 10) || 2
);
const UPLOAD_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.SOURCING_UPLOAD_CONCURRENCY || "2", 10) || 2
);

// Module-level worker locks (single Next.js process).
let downloadWorkerRunning = false;
let uploadWorkerRunning = false;

// ── Link parsing ─────────────────────────────────────────────────────────────

// Statuses that count as "already used" history for dedupe purposes.
const HISTORY_STATUSES = ["downloaded", "assigned", "uploaded"];

export async function parseLinks(text: string): Promise<ParseLinksResult> {
  // First pass without history to know which normalized URLs to look up.
  const firstPass = parseLinksPure(text, new Set());
  const candidates = firstPass.valid.map((v) => v.normalizedUrl);

  const historyRows = candidates.length
    ? await prisma.sourcedVideo.findMany({
        where: { normalizedUrl: { in: candidates }, status: { in: HISTORY_STATUSES } },
        select: { normalizedUrl: true },
      })
    : [];

  return parseLinksPure(text, new Set(historyRows.map((r) => r.normalizedUrl)));
}

// ── Run creation ─────────────────────────────────────────────────────────────

export async function startSourcingRun(userId: string | null, links: string[]) {
  const parsed = await parseLinks(links.join("\n"));
  const fresh = parsed.valid.filter((v) => !v.alreadyUsed);

  if (fresh.length === 0) {
    throw new Error(
      parsed.valid.length > 0
        ? "All valid links were already sourced before — nothing new to download"
        : "No valid TikTok video links found"
    );
  }

  const run = await prisma.sourcingRun.create({
    data: {
      createdBy: userId,
      linkCount: fresh.length,
      status: "DOWNLOADING",
      videos: {
        create: fresh.map((v) => ({
          sourceUrl: v.url,
          normalizedUrl: v.normalizedUrl,
          status: "queued",
          meta: v.videoId ? { videoId: v.videoId } : {},
        })),
      },
    },
  });

  triggerDownloadWorker();
  return { runId: run.id, created: fresh.length, parse: parsed };
}

// ── Download worker ──────────────────────────────────────────────────────────

export function triggerDownloadWorker() {
  if (downloadWorkerRunning) return;
  downloadWorkerRunning = true;
  processDownloadQueue()
    .catch((err) => console.error("[Sourcing Download Worker] Fatal:", err))
    .finally(() => {
      downloadWorkerRunning = false;
    });
}

async function processDownloadQueue() {
  console.log(`[Sourcing Download Worker] Starting (concurrency ${DOWNLOAD_CONCURRENCY})...`);

  // A previous process may have died mid-download — requeue stale claims.
  const recovered = await prisma.sourcedVideo.updateMany({
    where: { status: "downloading" },
    data: { status: "queued" },
  });
  if (recovered.count > 0) {
    console.log(`[Sourcing Download Worker] Requeued ${recovered.count} stale download(s)`);
  }

  await Promise.all(
    Array.from({ length: DOWNLOAD_CONCURRENCY }, (_, i) => downloadWorkerLoop(i + 1))
  );

  // Sweep: runs whose downloads are all terminal get their final status.
  const runs = await prisma.sourcingRun.findMany({
    where: { status: "DOWNLOADING" },
    include: { videos: { select: { status: true } } },
  });
  for (const run of runs) {
    const active = run.videos.some((v) => v.status === "queued" || v.status === "downloading");
    if (active) continue;
    const counts = countBy(run.videos.map((v) => v.status));
    const anySuccess = run.videos.some((v) =>
      ["downloaded", "assigned", "uploaded"].includes(v.status)
    );
    await prisma.sourcingRun.update({
      where: { id: run.id },
      data: {
        status: anySuccess ? "READY" : "FAILED",
        summary: { ...counts, phase: "download" },
      },
    });
  }
}

async function downloadWorkerLoop(workerId: number) {
  while (true) {
    const candidate = await prisma.sourcedVideo.findFirst({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!candidate) break;

    // Atomic claim: exactly one worker flips queued → downloading.
    const claimed = await prisma.sourcedVideo.updateMany({
      where: { id: candidate.id, status: "queued" },
      data: { status: "downloading" },
    });
    if (claimed.count === 0) continue;

    await downloadOneVideo(candidate.id).catch((err) => {
      console.error(`[Sourcing Download Worker ${workerId}] Unhandled:`, err);
    });
  }
}

async function downloadOneVideo(videoId: string) {
  const video = await prisma.sourcedVideo.findUnique({ where: { id: videoId } });
  if (!video) return;

  await fs.promises.mkdir(TEMP_DIR, { recursive: true });

  try {
    // TikTok hard-blocks yt-dlp from our datacenter IP, so downloads run
    // through Apify's infrastructure (scrape + mp4 from its key-value store).
    const result = await downloadTikTokVideo(video.sourceUrl, TEMP_DIR, video.id);

    const priorMeta = (video.meta as Record<string, unknown>) || {};
    await prisma.sourcedVideo.update({
      where: { id: video.id },
      data: {
        status: "downloaded",
        localPath: result.localPath,
        durationSec: result.durationSec,
        sizeBytes: BigInt(result.sizeBytes),
        error: null,
        meta: {
          ...priorMeta,
          ...result.meta,
        },
      },
    });
    console.log(`[Sourcing Download Worker] Downloaded ${video.normalizedUrl} → ${result.localPath}`);
  } catch (err: any) {
    const kind: string = err instanceof TikTokDownloadError ? err.kind : "transient";
    const message = `${kind}: ${err?.message || String(err)}`.slice(0, 400);
    await prisma.sourcedVideo.update({
      where: { id: video.id },
      data: { status: "failed", error: message },
    });
    console.warn(`[Sourcing Download Worker] Failed ${video.normalizedUrl}: ${message}`);
  }
}

export async function retryDownload(videoId: string) {
  const video = await prisma.sourcedVideo.findUnique({ where: { id: videoId } });
  if (!video) throw new Error("Video not found");
  if (video.status !== "failed") {
    throw new Error(`Only failed videos can be retried (current status: ${video.status})`);
  }
  await prisma.sourcedVideo.update({
    where: { id: videoId },
    data: { status: "queued", error: null },
  });
  await prisma.sourcingRun.update({
    where: { id: video.runId },
    data: { status: "DOWNLOADING" },
  });
  triggerDownloadWorker();
  return { ok: true };
}

export async function retryAllFailedDownloads(runId: string) {
  const reset = await prisma.sourcedVideo.updateMany({
    where: { runId, status: "failed" },
    data: { status: "queued", error: null },
  });
  if (reset.count > 0) {
    await prisma.sourcingRun.update({
      where: { id: runId },
      data: { status: "DOWNLOADING" },
    });
    triggerDownloadWorker();
  }
  return { retried: reset.count };
}

// ── Distribution planning ────────────────────────────────────────────────────

export async function previewDistribution(
  runId: string,
  accountCounts: { accountId: string; count: number }[],
  allowReuse = false
): Promise<DistributionPlanResult> {
  const videos = await prisma.sourcedVideo.findMany({
    where: { runId, status: "downloaded" },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  const accountIds = accountCounts.map((a) => a.accountId);
  const accounts = await prisma.managedAccount.findMany({
    where: { id: { in: accountIds } },
    select: { id: true, driveFolderId: true, driveFolderName: true },
  });
  const accountById = new Map<string, PlanAccount>(
    accounts
      .filter((a) => a.driveFolderId)
      .map((a) => [
        a.id,
        {
          accountId: a.id,
          driveFolderId: a.driveFolderId as string,
          driveFolderName: a.driveFolderName,
        },
      ])
  );

  return buildDistributionPlan(
    videos.map((v) => v.id),
    accountCounts,
    accountById,
    allowReuse
  );
}

export async function runDistribution(
  runId: string,
  plan: DistributionPlanResult["plan"]
) {
  if (plan.length === 0) {
    throw new Error("Empty distribution plan — nothing to upload");
  }

  await prisma.sourcedVideoAssignment.createMany({
    data: plan.map((p) => ({
      sourcedVideoId: p.sourcedVideoId,
      accountId: p.accountId,
      driveFolderId: p.driveFolderId,
      driveFolderName: p.driveFolderName,
      status: "queued",
    })),
  });

  await prisma.sourcedVideo.updateMany({
    where: { id: { in: [...new Set(plan.map((p) => p.sourcedVideoId))] } },
    data: { status: "assigned" },
  });
  await prisma.sourcingRun.update({
    where: { id: runId },
    data: { status: "DISTRIBUTING" },
  });

  triggerUploadWorker();
  return { assignmentCount: plan.length };
}

// ── Upload worker ────────────────────────────────────────────────────────────

export function triggerUploadWorker() {
  if (uploadWorkerRunning) return;
  uploadWorkerRunning = true;
  processUploadQueue()
    .catch((err) => console.error("[Sourcing Upload Worker] Fatal:", err))
    .finally(() => {
      uploadWorkerRunning = false;
    });
}

// Finds a file with the exact same name already sitting in the target folder —
// dedup guard so retries never double-upload (same pattern as smart export).
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

const MIME_BY_EXT: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
};

async function processUploadQueue() {
  console.log(`[Sourcing Upload Worker] Starting (concurrency ${UPLOAD_CONCURRENCY})...`);

  // Requeue assignments stuck in "uploading" from a dead process.
  const recovered = await prisma.sourcedVideoAssignment.updateMany({
    where: { status: "uploading" },
    data: { status: "queued" },
  });
  if (recovered.count > 0) {
    console.log(`[Sourcing Upload Worker] Requeued ${recovered.count} stale upload(s)`);
  }

  await Promise.all(
    Array.from({ length: UPLOAD_CONCURRENCY }, (_, i) => uploadWorkerLoop(i + 1))
  );

  // Sweep: runs whose assignments are all terminal get their final status.
  const runs = await prisma.sourcingRun.findMany({
    where: { status: "DISTRIBUTING" },
    include: {
      videos: { select: { status: true, assignments: { select: { status: true } } } },
    },
  });
  for (const run of runs) {
    const allAssignments = run.videos.flatMap((v) => v.assignments);
    const active = allAssignments.some((a) => a.status === "queued" || a.status === "uploading");
    if (active) continue;
    const counts = countBy(allAssignments.map((a) => a.status));
    const anyUploaded = allAssignments.some((a) => a.status === "uploaded");
    await prisma.sourcingRun.update({
      where: { id: run.id },
      data: {
        status: anyUploaded ? "DONE" : "FAILED",
        summary: { assignments: counts, phase: "distribute" },
      },
    });
  }
}

async function uploadWorkerLoop(workerId: number) {
  while (true) {
    const candidate = await prisma.sourcedVideoAssignment.findFirst({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!candidate) break;

    const claimed = await prisma.sourcedVideoAssignment.updateMany({
      where: { id: candidate.id, status: "queued" },
      data: { status: "uploading" },
    });
    if (claimed.count === 0) continue;

    await uploadOneAssignment(candidate.id).catch((err) => {
      console.error(`[Sourcing Upload Worker ${workerId}] Unhandled:`, err);
    });
  }
}

async function uploadOneAssignment(assignmentId: string) {
  const assignment = await prisma.sourcedVideoAssignment.findUnique({
    where: { id: assignmentId },
    include: { sourcedVideo: true },
  });
  if (!assignment) return;
  const video = assignment.sourcedVideo;

  try {
    if (!video.localPath || !fs.existsSync(video.localPath)) {
      throw new Error("local temp file is missing — retry the download instead");
    }

    const ext = path.extname(video.localPath) || ".mp4";
    const meta = (video.meta as Record<string, unknown>) || {};
    const baseName = typeof meta.videoId === "string" && meta.videoId ? meta.videoId : video.id;
    const fileName = `${baseName}${ext}`;

    // Dedup: reuse an existing file with the same name instead of duplicating.
    const drive = await getDriveClient(assignment.accountId);
    let driveFileId = await findExistingDriveFile(drive, fileName, assignment.driveFolderId);
    if (driveFileId) {
      console.log(`[Sourcing Upload Worker] Dedup hit: "${fileName}" already in folder ${assignment.driveFolderId}`);
    } else {
      const buffer = await fs.promises.readFile(video.localPath);
      driveFileId = await uploadFileToFolder(
        assignment.driveFolderId,
        fileName,
        buffer,
        MIME_BY_EXT[ext] || "video/mp4",
        assignment.accountId
      );
    }

    await prisma.sourcedVideoAssignment.update({
      where: { id: assignment.id },
      data: { status: "uploaded", driveFileId, uploadedAt: new Date(), error: null },
    });

    // Video is fully uploaded once no queued/uploading assignments remain.
    const remaining = await prisma.sourcedVideoAssignment.count({
      where: { sourcedVideoId: video.id, status: { in: ["queued", "uploading"] } },
    });
    if (remaining === 0) {
      const failed = await prisma.sourcedVideoAssignment.count({
        where: { sourcedVideoId: video.id, status: "failed" },
      });
      if (failed === 0) {
        await prisma.sourcedVideo.update({
          where: { id: video.id },
          data: { status: "uploaded" },
        });
      }
      // All assignments terminal → the temp file is no longer needed.
      await fs.promises.unlink(video.localPath).catch(() => {});
      console.log(`[Sourcing Upload Worker] Uploaded "${fileName}" and deleted temp file`);
    }
  } catch (err: any) {
    const message = (err?.message || "upload failed").slice(0, 500);
    // Keep the temp file so retryUpload can try again.
    await prisma.sourcedVideoAssignment.update({
      where: { id: assignment.id },
      data: { status: "failed", error: message },
    });
    console.warn(`[Sourcing Upload Worker] Failed assignment ${assignment.id}: ${message}`);
  }
}

export async function retryUpload(assignmentId: string) {
  const assignment = await prisma.sourcedVideoAssignment.findUnique({
    where: { id: assignmentId },
    include: { sourcedVideo: true },
  });
  if (!assignment) throw new Error("Assignment not found");
  if (assignment.status !== "failed") {
    throw new Error(`Only failed assignments can be retried (current status: ${assignment.status})`);
  }
  await prisma.sourcedVideoAssignment.update({
    where: { id: assignmentId },
    data: { status: "queued", error: null },
  });
  await prisma.sourcingRun.update({
    where: { id: assignment.sourcedVideo.runId },
    data: { status: "DISTRIBUTING" },
  });
  triggerUploadWorker();
  return { ok: true };
}

// ── Temp file cleanup ────────────────────────────────────────────────────────

const ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Deletes temp files older than 24h whose video is terminal (uploaded/failed)
 * or no longer exists in the DB. Wired into the prune cron route.
 */
export async function cleanupOrphanTempFiles() {
  const result = { deleted: 0, failed: 0, skipped: 0 };
  if (!fs.existsSync(TEMP_DIR)) return result;

  const cutoff = Date.now() - ORPHAN_MAX_AGE_MS;
  let files: string[] = [];
  try {
    files = await fs.promises.readdir(TEMP_DIR);
  } catch (err) {
    console.error("[Sourcing Cleanup] Failed to read temp dir:", err);
    return result;
  }

  for (const file of files) {
    if (file.startsWith(".")) {
      result.skipped++;
      continue;
    }
    const filePath = path.join(TEMP_DIR, file);
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile() || stat.mtimeMs >= cutoff) {
        result.skipped++;
        continue;
      }
      // Temp files are named "<sourcedVideoId>.<ext>".
      const videoId = file.split(".")[0];
      const video = await prisma.sourcedVideo.findUnique({
        where: { id: videoId },
        select: { status: true },
      });
      if (!video || video.status === "uploaded" || video.status === "failed") {
        await fs.promises.unlink(filePath);
        result.deleted++;
      } else {
        result.skipped++;
      }
    } catch (err) {
      console.error(`[Sourcing Cleanup] Failed to process ${filePath}:`, err);
      result.failed++;
    }
  }
  return result;
}

// ── Queries (API-facing, JSON-safe shapes) ───────────────────────────────────

function countBy(statuses: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of statuses) counts[s] = (counts[s] || 0) + 1;
  return counts;
}

// BigInt sizeBytes is not JSON-serializable — convert for API responses.
function serializeVideo(video: any) {
  return {
    ...video,
    sizeBytes: video.sizeBytes != null ? Number(video.sizeBytes) : null,
  };
}

export async function getSourcingRuns(limit = 20) {
  const runs = await prisma.sourcingRun.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
  });
  if (runs.length === 0) return [];

  const grouped = await prisma.sourcedVideo.groupBy({
    by: ["runId", "status"],
    where: { runId: { in: runs.map((r) => r.id) } },
    _count: { _all: true },
  });
  const countsByRun = new Map<string, Record<string, number>>();
  for (const row of grouped) {
    const counts = countsByRun.get(row.runId) || {};
    counts[row.status] = row._count._all;
    countsByRun.set(row.runId, counts);
  }

  return runs.map((run) => ({
    ...run,
    statusCounts: countsByRun.get(run.id) || {},
  }));
}

export async function getSourcingRun(runId: string) {
  const run = await prisma.sourcingRun.findUnique({
    where: { id: runId },
    include: {
      videos: {
        orderBy: { createdAt: "asc" },
        include: { assignments: { orderBy: { createdAt: "asc" } } },
      },
    },
  });
  if (!run) return null;
  return { ...run, videos: run.videos.map(serializeVideo) };
}

export async function searchSourcedVideos(urlQuery: string) {
  const videos = await prisma.sourcedVideo.findMany({
    where: {
      OR: [
        { sourceUrl: { contains: urlQuery, mode: "insensitive" } },
        { normalizedUrl: { contains: urlQuery, mode: "insensitive" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      run: { select: { id: true, createdAt: true, status: true } },
      assignments: {
        select: {
          id: true,
          accountId: true,
          driveFolderId: true,
          driveFolderName: true,
          driveFileId: true,
          status: true,
          uploadedAt: true,
          error: true,
        },
      },
    },
  });
  return videos.map(serializeVideo);
}
