/**
 * Video Factory service — mass-produces lyric/quote videos into a render pool,
 * then distributes them to TikTok accounts afterwards.
 *
 * Flow: RENDER FIRST, DISTRIBUTE AFTER.
 *   1. The batch's source of background clips is ONE pasted Drive folder
 *      (FactoryBatch.sourceFolderId, synced into the per-folder Drive ledger
 *      with accountId = null). Per-account input folders are only a wizard
 *      prefill hint — never the render source.
 *   2. startBatchRender takes only a total video count: it plans account-less
 *      FactoryBatchItems (styles/tracks/quotes come from the batch's own
 *      content-pool columns), reserving ledger clips in `sourceDriveFileIds`
 *      (markFilesUsed ONLY after a successful render — a failed render leaves
 *      files unused). Recipe planning + fingerprint dedup unchanged (see below).
 *   3. The worker renders each item into the pool: local mp4 in
 *      public/uploads/factory-renders/ + R2 offload (Multiplier-output style).
 *      NO Drive upload and NO Delivery at render time.
 *   4. distributeBatch() on a COMPLETED batch deals pool items to accounts
 *      (fair round-robin mixer from smart-export-assign, bucketed by styleId,
 *      leftovers dealt fewest-first), uploads each assigned video to the
 *      account's OUTPUT driveFolderId with campaign-bracket naming, marks
 *      items distributed (distributedAt/distributedToAccountId), then records
 *      a Delivery per account (Track D's createDelivery — postingMode:
 *      postpeerAccountId && isActive → "auto_post", else "manual").
 *   5. getFactoryDownloadStatus() packages all COMPLETED items into one tar
 *      archive (background prep + status JSON + R2, the multiplier download
 *      pattern) for Smart Download.
 *
 * Recipe planning is two-phase: startBatchRender stores a PLANNED recipe (clip
 * ids + planned trim starts/slice durations drawn against a nominal 8s clip
 * window); the worker materializes real trim windows after ffprobe by
 * proportionally mapping planned starts onto each clip's real duration.
 *
 * Uniqueness: recipeFingerprint = SHA-256 over clip ids + rounded planned
 * start times + audio ref (when mixingEnabled; over clip id + audio ref when
 * not). Duplicate fingerprints inside one batch are re-planned (≤100 tries),
 * then skipped. Pooled per-folder ledger selection guarantees a file is never
 * used twice within a batch.
 *
 * Concurrency: a single module-level worker lock drains QUEUED batches one at
 * a time, items sequentially (VPS-safe). "Allow reuse when exhausted" is a
 * render-time option carried in the preview/render request payloads (the
 * FactoryBatch schema has no flags column); the wizard persists it in its own
 * state and sends it with both calls.
 */
import prisma from "@/lib/db";
import { Prisma } from "@prisma/client";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import type { FactoryBatch, SavedStyle, Track } from "@prisma/client";
import { selectUnusedFilesByFolder, markFilesUsed, getLedgerStats } from "./drive-ledger";
import { createDelivery } from "./distribution";
import { downloadDriveFile, getDriveClient } from "../google";
import { uploadToR2, downloadFromR2 } from "./storage";
import { formatCampaignBracketPrefix } from "./multiplier-export";
import { assignVideosFairRoundRobin } from "./smart-export-assign";

const execAsync = promisify(exec);

// ── Constants ────────────────────────────────────────────────────────────────

/** Nominal per-clip usable window (seconds) used when PLANNING slices (pre-ffprobe). */
const NOMINAL_CLIP_SECONDS = 8.0;
/** Estimated render time per video for pre-flight (seconds). */
const EST_SECONDS_PER_VIDEO = 20;
/** Max attempts to draw a unique recipe fingerprint per item. */
const MAX_RECIPE_ATTEMPTS = 100;
/** Local public dir + R2 prefix for rendered pool videos. */
const RENDER_DIR_PUBLIC = "/uploads/factory-renders";
/** Local public dir + R2 prefix for Smart Download archives. */
const ARCHIVE_DIR_PUBLIC = "/uploads/factory/archives";

export type FactoryMode = "lyric" | "quote";

export interface CreateBatchInput {
  name: string;
  mode: FactoryMode;
  mixingEnabled: boolean;
  variationStrength: number; // 1-5
  targetDuration: number; // seconds
  campaignId?: string | null;
  styleIds: string[];
  /** Pasted Drive folder that supplies background clips for the whole batch. */
  sourceFolderId: string;
  /** lyric mode: ordered track pool (round-robin, Track.maxReuse respected) */
  trackIds?: string[];
  /** quote mode: quote texts (round-robin) */
  quotes?: string[];
  createdBy?: string | null;
}

export interface BatchAssignment {
  accountId: string;
  videoCount: number;
}

export interface RenderInput {
  totalVideos: number;
  /** when false (default), exhaustion of unused source clips refuses the run */
  allowReuseWhenExhausted?: boolean;
}

// ── Recipe types ─────────────────────────────────────────────────────────────

export interface PlannedSlice {
  /** DriveFile ledger row id (reservation held in FactoryBatchItem.sourceDriveFileIds). */
  ledgerId: string;
  /** Planned trim start (seconds) against the nominal clip window. */
  plannedStart: number;
  /** Planned slice duration (seconds). */
  plannedDuration: number;
}

export interface FactoryRecipe {
  version: 1;
  mixingEnabled: boolean;
  variationStrength: number;
  nominalClipSeconds: number;
  slices: PlannedSlice[];
  durationSeconds: number;
  styleId: string | null;
  trackId?: string | null;
  trimStart?: number;
  trimEnd?: number | null;
  quoteText?: string | null;
}

// ── Small helpers ────────────────────────────────────────────────────────────

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function clampStrength(s: number): number {
  if (!Number.isFinite(s)) return 3;
  return Math.max(1, Math.min(5, Math.round(s)));
}

/**
 * Minimum slice duration per strength — used to compute the max number of
 * source clips an item may need (over-reservation is harmless: only files
 * actually materialized into the render are marked used).
 */
function minSliceSeconds(strength: number): number {
  switch (strength) {
    case 1: return 4.0;
    case 2: return 3.5;
    case 3: return 3.0;
    case 4: return 2.5;
    case 5: return 2.0;
    default: return 3.0;
  }
}

/** Source clips reserved per item. */
export function filesPerItem(mixingEnabled: boolean, variationStrength: number, targetDuration: number): number {
  if (!mixingEnabled) return 1;
  const strength = clampStrength(variationStrength);
  // +1 headroom for the last-slice padding rule (clip shorter than remaining).
  return Math.max(1, Math.ceil(targetDuration / minSliceSeconds(strength)) + 1);
}

/**
 * Computes the recipe fingerprint. When mixing: SHA-256 over clip ids +
 * rounded planned start times + audio ref. When not: clip id + audio ref.
 */
export function calculateFactoryFingerprint(recipe: FactoryRecipe, audioRef: string): string {
  const payload =
    recipe.mixingEnabled
      ? {
          s: recipe.slices.map((s) => [s.ledgerId, round1(s.plannedStart), round1(s.plannedDuration)]),
          a: audioRef,
          st: recipe.styleId,
        }
      : {
          c: recipe.slices.map((s) => s.ledgerId),
          a: audioRef,
          st: recipe.styleId,
        };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * Plans slice order/starts/durations for one item — variation-strength
 * semantics ported from clip-mixer (`generateRecipesForBatch`):
 *  1 deterministic sequential order, trim start 0, fixed 4.0s slices
 *  2 minimal shuffle, 3-segment trims (start/middle/end), 3.5–4.5s slices
 *  3 full shuffle, random trims, 3.0–5.0s slices (default)
 *  4 shuffle + random trims + variable 2.5–5.5s slices
 *  5 shuffle + random trims + variable 2.0–6.0s slices, ±6s duration variance
 */
export function planSlicesForItem(opts: {
  ledgerIds: string[];
  itemIndex: number;
  targetDuration: number;
  variationStrength: number;
}): PlannedSlice[] {
  const { ledgerIds, itemIndex, targetDuration, variationStrength: rawStrength } = opts;
  const variationStrength = clampStrength(rawStrength);

  // Target duration with strength-controlled variance (clip-mixer semantics).
  let T = targetDuration;
  if (variationStrength >= 3) {
    const varMax = variationStrength === 3 ? 2 : variationStrength === 4 ? 4 : 6;
    T += Math.random() * (varMax * 2) - varMax;
  }
  if (T < 5.0) T = 5.0;

  // Order: strength 1 = deterministic rotation, 2+ = shuffle.
  let ordered = [...ledgerIds];
  if (variationStrength >= 2) {
    shuffleInPlace(ordered);
  } else {
    const off = ordered.length > 0 ? itemIndex % ordered.length : 0;
    ordered = [...ordered.slice(off), ...ordered.slice(0, off)];
  }

  const slices: PlannedSlice[] = [];
  let current = 0;
  for (const ledgerId of ordered) {
    if (current >= T) break;
    const remaining = T - current;

    let sliceDuration = 4.0;
    if (variationStrength >= 4) {
      const minDur = variationStrength === 4 ? 2.5 : 2.0;
      const maxDur = variationStrength === 4 ? 5.5 : 6.0;
      sliceDuration = Math.random() * (maxDur - minDur) + minDur;
    } else if (variationStrength === 3) {
      sliceDuration = Math.random() * 2.0 + 3.0;
    } else if (variationStrength === 2) {
      sliceDuration = 4.0 + (Math.random() * 1.0 - 0.5);
    }

    // Clamp to nominal clip window and remaining time (clip-mixer rules).
    if (sliceDuration > NOMINAL_CLIP_SECONDS) sliceDuration = NOMINAL_CLIP_SECONDS;
    if (sliceDuration > remaining) sliceDuration = remaining;
    if (remaining <= 5.0) {
      sliceDuration = NOMINAL_CLIP_SECONDS >= remaining ? remaining : NOMINAL_CLIP_SECONDS;
    }

    // Planned trim start against the nominal window.
    let start = 0;
    const maxStart = Math.max(0, NOMINAL_CLIP_SECONDS - sliceDuration);
    if (maxStart > 0) {
      if (variationStrength >= 3) {
        start = Math.random() * maxStart;
      } else if (variationStrength === 2) {
        const segment = Math.floor(Math.random() * 3);
        start = (segment / 2) * maxStart;
      }
    }

    slices.push({ ledgerId, plannedStart: round1(start), plannedDuration: round1(sliceDuration) });
    current += sliceDuration;
  }
  return slices;
}

// ── Batch CRUD ───────────────────────────────────────────────────────────────

export async function createBatch(input: CreateBatchInput): Promise<FactoryBatch> {
  if (!input.name?.trim()) throw new Error("Batch name is required");
  if (input.mode !== "lyric" && input.mode !== "quote") throw new Error("mode must be lyric or quote");
  if (!Array.isArray(input.styleIds) || input.styleIds.length === 0) {
    throw new Error("Select at least one style");
  }
  const styles = await prisma.savedStyle.findMany({ where: { id: { in: input.styleIds } }, select: { id: true } });
  if (styles.length !== input.styleIds.length) throw new Error("One or more styles were not found");
  if (input.campaignId) {
    const campaign = await prisma.campaign.findUnique({ where: { id: input.campaignId }, select: { id: true } });
    if (!campaign) throw new Error("Campaign not found");
  }
  const targetDuration = Number(input.targetDuration);
  if (!Number.isFinite(targetDuration) || targetDuration < 5 || targetDuration > 600) {
    throw new Error("targetDuration must be between 5 and 600 seconds");
  }
  if (!input.sourceFolderId?.trim()) {
    throw new Error("A source Drive folder is required (paste and sync one in step 1)");
  }

  // Content pool lives on the batch — render takes only a total count.
  let trackIds: string[] = [];
  let quotes: string[] = [];
  if (input.mode === "lyric") {
    trackIds = (input.trackIds ?? []).filter((t) => typeof t === "string" && t.trim());
    if (trackIds.length === 0) throw new Error("Add at least one lyric track");
    const tracks = await prisma.track.findMany({ where: { id: { in: trackIds } }, select: { id: true } });
    if (tracks.length !== trackIds.length) throw new Error("One or more tracks were not found");
  } else {
    quotes = (input.quotes ?? []).map((q) => String(q).trim()).filter(Boolean);
    if (quotes.length === 0) throw new Error("Add at least one quote");
  }

  return prisma.factoryBatch.create({
    data: {
      name: input.name.trim(),
      mode: input.mode,
      mixingEnabled: !!input.mixingEnabled,
      variationStrength: clampStrength(input.variationStrength),
      targetDuration,
      campaignId: input.campaignId ?? null,
      styleIds: input.styleIds,
      sourceFolderId: input.sourceFolderId.trim(),
      trackIds,
      quotes,
      status: "DRAFT",
      createdBy: input.createdBy ?? null,
    },
  });
}

export async function listBatches() {
  const batches = await prisma.factoryBatch.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const counts = await prisma.factoryBatchItem.groupBy({
    by: ["batchId", "status"],
    _count: { _all: true },
  });
  const byBatch = new Map<string, Record<string, number>>();
  for (const c of counts) {
    const m = byBatch.get(c.batchId) ?? {};
    m[c.status] = c._count._all;
    byBatch.set(c.batchId, m);
  }
  return batches.map((b) => {
    const c = byBatch.get(b.id) ?? {};
    const total = Object.values(c).reduce((a, n) => a + n, 0);
    return {
      ...b,
      itemCounts: {
        total,
        pending: c.PENDING ?? 0,
        rendering: c.RENDERING ?? 0,
        completed: c.COMPLETED ?? 0,
        failed: c.FAILED ?? 0,
      },
    };
  });
}

export async function getBatch(batchId: string) {
  const batch = await prisma.factoryBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new Error("Batch not found");
  const items = await prisma.factoryBatchItem.findMany({
    where: { batchId },
    orderBy: { createdAt: "asc" },
  });
  // Account lookups cover both render-time accountId (legacy) and
  // distribute-time distributedToAccountId.
  const accountIds = [
    ...new Set(items.flatMap((i) => [i.accountId, i.distributedToAccountId]).filter(Boolean)),
  ] as string[];
  const accounts = await prisma.managedAccount.findMany({
    where: { id: { in: accountIds } },
    select: { id: true, tiktokUsername: true, tiktokDisplayName: true, color: true },
  });
  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  const trackIds = [...new Set(items.map((i) => i.trackId).filter(Boolean))] as string[];
  const tracks = await prisma.track.findMany({
    where: { id: { in: trackIds } },
    select: { id: true, title: true, artist: true },
  });
  const trackMap = new Map(tracks.map((t) => [t.id, t]));
  const styles = await prisma.savedStyle.findMany({
    where: { id: { in: batch.styleIds } },
    select: { id: true, name: true, templateKey: true, thumbnail: true },
  });
  const styleMap = new Map(styles.map((s) => [s.id, s]));
  const campaign = batch.campaignId
    ? await prisma.campaign.findUnique({ where: { id: batch.campaignId }, select: { id: true, title: true, slug: true } })
    : null;

  return {
    ...batch,
    campaign,
    styles,
    items: items.map((i) => ({
      ...i,
      account: i.accountId ? accountMap.get(i.accountId) ?? null : null,
      distributedToAccount: i.distributedToAccountId ? accountMap.get(i.distributedToAccountId) ?? null : null,
      track: i.trackId ? trackMap.get(i.trackId) ?? null : null,
      style: i.styleId ? styleMap.get(i.styleId) ?? null : null,
    })),
  };
}

// ── Pre-flight preview ───────────────────────────────────────────────────────

export interface PreviewResult {
  sourceFolderId: string;
  totalVideos: number;
  filesNeeded: number;
  availableUnused: number;
  exhausted: boolean;
  stylesCount: number;
  estimatedSeconds: number;
  warnings: string[];
  canRender: boolean;
}

function validateRenderInput(batch: FactoryBatch, input: RenderInput) {
  if (!batch.sourceFolderId) {
    throw new Error("Batch has no source Drive folder — paste and sync one in step 1");
  }
  if (!Number.isInteger(input.totalVideos) || input.totalVideos < 1 || input.totalVideos > 2000) {
    throw new Error("totalVideos must be an integer between 1 and 2000");
  }
  if (batch.mode === "lyric" && batch.trackIds.length === 0) {
    throw new Error("Batch has no lyric tracks — add at least one in step 2");
  }
  if (batch.mode === "quote" && batch.quotes.length === 0) {
    throw new Error("Batch has no quotes — add at least one in step 2");
  }
}

export async function previewBatch(batchId: string, input: RenderInput): Promise<PreviewResult> {
  const batch = await prisma.factoryBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new Error("Batch not found");
  validateRenderInput(batch, input);

  const allowReuse = !!input.allowReuseWhenExhausted;
  const perItem = filesPerItem(batch.mixingEnabled, batch.variationStrength, batch.targetDuration);
  const filesNeeded = input.totalVideos * perItem;
  const warnings: string[] = [];
  let blocking = false;

  // Dry-run selection against the batch's source folder: reads the ledger
  // without consuming anything.
  const sel = await selectUnusedFilesByFolder(batch.sourceFolderId!, filesNeeded);
  const exhausted = sel.exhausted;
  if (exhausted) {
    warnings.push(
      `The source folder has only ${sel.availableUnused} unused background clips but the batch needs ${filesNeeded} ` +
      `(${input.totalVideos} videos × ${perItem} clips). ` +
      (allowReuse
        ? `Reuse is allowed — least-recently-used clips will repeat.`
        : `Rendering will refuse until more clips are synced or "Allow reuse when exhausted" is enabled.`)
    );
    if (!allowReuse) blocking = true;
  }

  // Content-pool capacity checks.
  if (batch.mode === "lyric") {
    const tracks = await prisma.track.findMany({ where: { id: { in: batch.trackIds } } });
    const finiteCaps = tracks.filter((t) => t.maxReuse !== null && t.maxReuse !== undefined);
    const hasUnlimited = tracks.some((t) => t.maxReuse === null || t.maxReuse === undefined);
    if (!hasUnlimited && finiteCaps.length > 0) {
      const capacity = finiteCaps.reduce((sum, t) => sum + Math.max(0, t.maxReuse ?? 0), 0);
      if (capacity < input.totalVideos) {
        warnings.push(
          `Selected tracks allow at most ${capacity} videos (sum of max-reuse), but ${input.totalVideos} are requested. Add more tracks or raise max-reuse.`
        );
        blocking = true;
      }
    }
  } else if (batch.quotes.length < input.totalVideos) {
    warnings.push(
      `${batch.quotes.length} unique quotes for ${input.totalVideos} videos — quotes will repeat.`
    );
  }

  return {
    sourceFolderId: batch.sourceFolderId!,
    totalVideos: input.totalVideos,
    filesNeeded,
    availableUnused: sel.availableUnused,
    exhausted,
    stylesCount: batch.styleIds.length,
    estimatedSeconds: input.totalVideos * EST_SECONDS_PER_VIDEO,
    warnings,
    canRender: !blocking,
  };
}

// ── Render start ─────────────────────────────────────────────────────────────

export interface StartRenderResult {
  itemsCreated: number;
  skippedDuplicates: number;
  warnings: string[];
}

export async function startBatchRender(batchId: string, input: RenderInput): Promise<StartRenderResult> {
  const batch = await prisma.factoryBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new Error("Batch not found");
  if (batch.status === "RENDERING") throw new Error("Batch is already rendering");
  const existingItems = await prisma.factoryBatchItem.count({ where: { batchId } });
  if (existingItems > 0) {
    throw new Error("Batch already has items — use retry-failed instead of re-rendering");
  }
  validateRenderInput(batch, input);

  // Pre-flight gate: refuse on exhaustion unless reuse is explicitly allowed.
  const preview = await previewBatch(batchId, input);
  if (!preview.canRender) {
    throw new Error(preview.warnings[0] ?? "Pre-flight checks failed");
  }

  const perItem = filesPerItem(batch.mixingEnabled, batch.variationStrength, batch.targetDuration);
  const usedFingerprints = new Set<string>();
  const warnings: string[] = [];
  let itemsCreated = 0;
  let skippedDuplicates = 0;

  // Content pools come from the batch's own columns (render takes no assignments).
  let tracks: Track[] = [];
  if (batch.mode === "lyric") {
    tracks = await prisma.track.findMany({ where: { id: { in: batch.trackIds } } });
    if (tracks.length !== batch.trackIds.length) throw new Error("One or more tracks were not found");
    // Preserve the batch's ordering for deterministic round-robin.
    const order = new Map(batch.trackIds.map((id, idx) => [id, idx]));
    tracks.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }
  const quotes = batch.quotes.map((q) => q.trim()).filter(Boolean);
  const trackUseCount = new Map<string, number>();
  let globalItemIndex = 0;

  /** Next track in round-robin that still has reuse capacity (null = exhausted). */
  function nextTrack(): Track | null {
    for (let n = 0; n < tracks.length * 4; n++) {
      const t = tracks[(globalItemIndex + n) % tracks.length];
      const used = trackUseCount.get(t.id) ?? 0;
      if (t.maxReuse === null || t.maxReuse === undefined || used < t.maxReuse) {
        trackUseCount.set(t.id, used + 1);
        globalItemIndex += n + 1;
        return t;
      }
    }
    return null;
  }

  // Pooled reservation: ONE ledger read against the batch's source folder,
  // partitioned per item — a file can never appear twice in this batch.
  const pooled = await selectUnusedFilesByFolder(batch.sourceFolderId!, input.totalVideos * perItem);
  if (pooled.files.length < input.totalVideos * perItem) {
    warnings.push(
      `Source folder: only ${pooled.files.length} clips available for ${input.totalVideos * perItem} slots; later items may reuse fewer clips.`
    );
  }

  for (let j = 0; j < input.totalVideos; j++) {
    // Content for this item.
    let track: Track | null = null;
    let quoteText: string | null = null;
    if (batch.mode === "lyric") {
      track = nextTrack();
      if (!track) {
        warnings.push(`Track max-reuse capacity reached — remaining items skipped.`);
        skippedDuplicates += input.totalVideos - j;
        break;
      }
    } else {
      quoteText = quotes[globalItemIndex % quotes.length];
      globalItemIndex++;
    }

    // Styles spread round-robin across the whole pool.
    const styleId = batch.styleIds[j % batch.styleIds.length];
    const durationSeconds =
      batch.mode === "lyric" && track
        ? Math.max(1.0, (track.trimEnd ?? track.trimStart + batch.targetDuration) - track.trimStart)
        : batch.targetDuration;

    // Reserve this item's clips from the folder pool.
    const reserved = pooled.files.slice(j * perItem, (j + 1) * perItem);
    if (reserved.length === 0) {
      warnings.push(`No clips left for item ${j + 1} — skipped.`);
      skippedDuplicates++;
      continue;
    }
    const ledgerIds = reserved.map((f) => f.id);

    // Planned recipe + fingerprint with dedup (≤ MAX_RECIPE_ATTEMPTS draws).
    const audioRef =
      batch.mode === "lyric" && track
        ? `${track.id}@${round1(track.trimStart)}-${track.trimEnd !== null ? round1(track.trimEnd) : "end"}`
        : `quote:${createHash("sha256").update(quoteText ?? "").digest("hex").slice(0, 16)}`;

    let recipe: FactoryRecipe | null = null;
    let fingerprint = "";
    let attempts = 0;
    while (attempts < MAX_RECIPE_ATTEMPTS) {
      const slices = planSlicesForItem({
        ledgerIds,
        itemIndex: j,
        targetDuration: durationSeconds,
        variationStrength: batch.variationStrength,
      });
      recipe = {
        version: 1,
        mixingEnabled: batch.mixingEnabled,
        variationStrength: batch.variationStrength,
        nominalClipSeconds: NOMINAL_CLIP_SECONDS,
        slices,
        durationSeconds: round1(durationSeconds),
        styleId,
        trackId: track?.id ?? null,
        trimStart: track?.trimStart ?? 0,
        trimEnd: track?.trimEnd ?? null,
        quoteText,
      };
      fingerprint = calculateFactoryFingerprint(recipe, audioRef);
      if (!usedFingerprints.has(fingerprint)) {
        usedFingerprints.add(fingerprint);
        break;
      }
      attempts++;
      recipe = null;
    }
    if (!recipe) {
      skippedDuplicates++;
      continue;
    }

    // Account-less: the item joins the render pool, distribution happens later.
    await prisma.factoryBatchItem.create({
      data: {
        batchId,
        accountId: null,
        styleId,
        trackId: track?.id ?? null,
        quoteText,
        recipe: recipe as any,
        recipeFingerprint: fingerprint,
        sourceDriveFileIds: ledgerIds,
        status: "PENDING",
      },
    });
    itemsCreated++;
  }

  if (itemsCreated === 0) {
    throw new Error("No items could be created (all recipes were duplicates or no clips available)");
  }

  await prisma.factoryBatch.update({
    where: { id: batchId },
    data: { status: "QUEUED" },
  });

  triggerFactoryWorker();
  return { itemsCreated, skippedDuplicates, warnings };
}

// ── Retries ──────────────────────────────────────────────────────────────────

export async function retryItem(itemId: string): Promise<void> {
  const item = await prisma.factoryBatchItem.findUnique({ where: { id: itemId } });
  if (!item) throw new Error("Item not found");
  if (item.status !== "FAILED") throw new Error("Only FAILED items can be retried");
  await prisma.factoryBatchItem.update({
    where: { id: itemId },
    data: { status: "PENDING", error: null },
  });
  await prisma.factoryBatch.update({
    where: { id: item.batchId },
    data: { status: "QUEUED" },
  });
  triggerFactoryWorker();
}

export async function retryFailedItems(batchId: string): Promise<number> {
  const res = await prisma.factoryBatchItem.updateMany({
    where: { batchId, status: "FAILED" },
    data: { status: "PENDING", error: null },
  });
  if (res.count > 0) {
    await prisma.factoryBatch.update({
      where: { id: batchId },
      data: { status: "QUEUED" },
    });
    triggerFactoryWorker();
  }
  return res.count;
}

// ── Track management ─────────────────────────────────────────────────────────

export interface UpsertTrackInput {
  title: string;
  artist?: string | null;
  /** Synced lyric lines from LRCLIB / manual paste: [{t, text}] (seconds). */
  lrcLines: { t: number; text: string }[];
  trimStart: number;
  trimEnd?: number | null;
  maxReuse?: number | null;
  /** Local public path ("/uploads/...") or R2 key of the full audio file. */
  audioRef: string;
  createdBy?: string | null;
}

/**
 * Stores a lyric track produced by the wizard (which fetches LRCLIB versions,
 * YouTube audio candidates, and trims via the existing genres lyric-generator
 * endpoints). Upserts on (title, artist, trimStart, trimEnd).
 */
export async function upsertTrackFromLrclib(input: UpsertTrackInput): Promise<Track> {
  if (!input.title?.trim()) throw new Error("Track title is required");
  if (!input.audioRef?.trim()) throw new Error("audioRef is required (download audio first)");
  if (!Array.isArray(input.lrcLines) || input.lrcLines.length === 0) {
    throw new Error("lrcLines is required (pick a synced lyric version or paste .lrc)");
  }
  const lrcLines = input.lrcLines
    .filter((l) => Number.isFinite(l.t) && typeof l.text === "string")
    .map((l) => ({ t: round1(Math.max(0, l.t)), text: l.text }))
    .sort((a, b) => a.t - b.t);
  if (lrcLines.length === 0) throw new Error("No valid lyric lines");

  const trimStart = Math.max(0, Number(input.trimStart) || 0);
  const trimEnd = input.trimEnd !== null && input.trimEnd !== undefined ? Number(input.trimEnd) : null;
  if (trimEnd !== null && (!Number.isFinite(trimEnd) || trimEnd <= trimStart)) {
    throw new Error("trimEnd must be greater than trimStart");
  }
  const maxReuse =
    input.maxReuse === null || input.maxReuse === undefined
      ? null
      : Math.max(1, Math.floor(Number(input.maxReuse)));
  const duration = trimEnd ?? lrcLines[lrcLines.length - 1].t + 4.0;

  // Upsert key: same song + same trim window = same factory track.
  const existing = await prisma.track.findFirst({
    where: {
      title: input.title.trim(),
      artist: input.artist?.trim() || null,
      trimStart,
      trimEnd,
      isLyrical: true,
    },
  });

  const data = {
    title: input.title.trim(),
    artist: input.artist?.trim() || null,
    fileUrl: input.audioRef.trim(),
    audioRef: input.audioRef.trim(),
    duration,
    trimStart,
    trimEnd,
    maxReuse,
    lrcData: lrcLines as any,
    isLyrical: true,
    createdBy: input.createdBy ?? null,
  };

  if (existing) {
    return prisma.track.update({ where: { id: existing.id }, data });
  }
  return prisma.track.create({ data: { ...data, defaultStart: trimStart, defaultDuration: duration - trimStart } });
}

export async function listFactoryTracks() {
  const tracks = await prisma.track.findMany({
    where: { lrcData: { not: Prisma.DbNull } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const usage = await prisma.factoryBatchItem.groupBy({
    by: ["trackId"],
    _count: { _all: true },
    where: { trackId: { in: tracks.map((t) => t.id) } },
  });
  const usageMap = new Map(usage.map((u) => [u.trackId, u._count._all]));
  return tracks.map((t) => ({
    id: t.id,
    title: t.title,
    artist: t.artist,
    duration: t.duration,
    trimStart: t.trimStart,
    trimEnd: t.trimEnd,
    maxReuse: t.maxReuse,
    audioRef: t.audioRef,
    lineCount: Array.isArray(t.lrcData) ? (t.lrcData as any[]).length : 0,
    timesUsed: usageMap.get(t.id) ?? 0,
    createdAt: t.createdAt,
  }));
}

// ── Worker (sequential, module lock, concurrency 1) ──────────────────────────

let factoryWorkerRunning = false;

/**
 * Starts the background drain loop if not already running. Fire-and-forget:
 * processes QUEUED batches one at a time, items sequentially.
 */
export function triggerFactoryWorker(): void {
  if (factoryWorkerRunning) return;
  factoryWorkerRunning = true;
  (async () => {
    try {
      for (;;) {
        const next = await prisma.factoryBatch.findFirst({
          where: {
            status: { in: ["QUEUED", "RENDERING"] },
            items: { some: { status: { in: ["PENDING", "RENDERING"] } } },
          },
          orderBy: { updatedAt: "asc" },
        });
        if (!next) break;
        await processFactoryBatch(next.id);
      }
    } catch (err) {
      console.error("[Factory Worker] Drain loop error:", err);
    } finally {
      factoryWorkerRunning = false;
    }
  })();
}

async function processFactoryBatch(batchId: string): Promise<void> {
  console.log(`[Factory Worker] Processing batch ${batchId}`);
  try {
    // Recover items orphaned mid-render by a crash/restart.
    await prisma.factoryBatchItem.updateMany({
      where: { batchId, status: "RENDERING" },
      data: { status: "PENDING" },
    });
    await prisma.factoryBatch.update({ where: { id: batchId }, data: { status: "RENDERING" } });

    for (;;) {
      const item = await prisma.factoryBatchItem.findFirst({
        where: { batchId, status: "PENDING" },
        orderBy: { createdAt: "asc" },
      });
      if (!item) break;

      const batchStillAlive = await prisma.factoryBatch.findUnique({ where: { id: batchId }, select: { status: true } });
      if (!batchStillAlive) return; // deleted mid-run

      try {
        // Renders into the pool only — Drive upload + Delivery happen later,
        // in distributeBatch().
        await renderFactoryItem(item.id);
      } catch (itemErr: any) {
        if (itemErr?.code === "P2025") return; // batch deleted mid-run
        console.error(`[Factory Worker] Item ${item.id} failed:`, itemErr);
        try {
          await prisma.factoryBatchItem.update({
            where: { id: item.id },
            data: { status: "FAILED", error: String(itemErr?.message ?? itemErr).slice(0, 4000) },
          });
        } catch (updateErr: any) {
          if (updateErr?.code === "P2025") return;
          throw updateErr;
        }
      }
    }

    // Rollup.
    const items = await prisma.factoryBatchItem.findMany({ where: { batchId }, select: { status: true } });
    const failed = items.filter((i) => i.status === "FAILED").length;
    const completed = items.filter((i) => i.status === "COMPLETED").length;
    const finalStatus = failed > 0 && completed === 0 ? "FAILED" : "COMPLETED";
    await prisma.factoryBatch.update({ where: { id: batchId }, data: { status: finalStatus } });
    console.log(`[Factory Worker] Batch ${batchId} finished: ${finalStatus} (${completed} ok, ${failed} failed)`);
  } catch (err: any) {
    if (err?.code === "P2025") return;
    console.error(`[Factory Worker] Critical error in batch ${batchId}:`, err);
    try {
      await prisma.factoryBatch.update({ where: { id: batchId }, data: { status: "FAILED" } });
    } catch (updateErr: any) {
      if (updateErr?.code !== "P2025") console.error("[Factory Worker] Failed to mark batch FAILED:", updateErr);
    }
  }
}

// ── Per-item render ──────────────────────────────────────────────────────────

/** Public path + R2 key of an item's rendered pool video. */
function renderRefForItem(itemId: string) {
  return {
    publicPath: `${RENDER_DIR_PUBLIC}/render_${itemId}.mp4`,
    r2Key: `uploads/factory-renders/render_${itemId}.mp4`,
  };
}

async function renderFactoryItem(itemId: string): Promise<void> {
  const item = await prisma.factoryBatchItem.findUnique({
    where: { id: itemId },
    include: { batch: true, track: true },
  });
  if (!item) throw new Error("Item not found");
  const recipe = item.recipe as unknown as FactoryRecipe | null;
  if (!recipe || !Array.isArray(recipe.slices) || recipe.slices.length === 0) {
    throw new Error("Item has no recipe");
  }

  await prisma.factoryBatchItem.update({ where: { id: itemId }, data: { status: "RENDERING", error: null } });

  const tempDir = path.join(process.cwd(), "public", "uploads", "factory", itemId);
  fs.mkdirSync(tempDir, { recursive: true });
  const { publicPath, r2Key } = renderRefForItem(itemId);
  const rendersDir = path.join(process.cwd(), "public", RENDER_DIR_PUBLIC);
  fs.mkdirSync(rendersDir, { recursive: true });
  const finalOutFile = path.join(process.cwd(), "public", publicPath);
  const localOutFile = path.join(tempDir, `render_${itemId}.mp4`);
  /** Ledger ids actually materialized into the render (marked used on success). */
  const usedLedgerIds: string[] = [];

  try {
    // 1) Download reserved source clips to temp + probe durations.
    //    No account context: master-OAuth → service-account chain.
    const ledgerRows = await prisma.driveFile.findMany({ where: { id: { in: recipe.slices.map((s) => s.ledgerId) } } });
    const ledgerMap = new Map(ledgerRows.map((r) => [r.id, r]));
    const clipLocal = new Map<string, { path: string; duration: number }>();
    for (const slice of recipe.slices) {
      if (clipLocal.has(slice.ledgerId)) continue;
      const row = ledgerMap.get(slice.ledgerId);
      if (!row) throw new Error(`Reserved clip ${slice.ledgerId} is no longer in the ledger`);
      const buf = await downloadDriveFile(row.driveFileId, undefined, false);
      const clipPath = path.join(tempDir, `clip_${row.id}.mp4`);
      fs.writeFileSync(clipPath, buf);
      clipLocal.set(row.id, { path: clipPath, duration: await probeDuration(clipPath) });
    }

    // 2) Materialize slices: map planned starts onto real clip durations.
    const useSlices = recipe.mixingEnabled ? recipe.slices : recipe.slices.slice(0, 1);
    const materialized: { clipPath: string; start: number; duration: number }[] = [];
    for (const slice of useSlices) {
      const clip = clipLocal.get(slice.ledgerId)!;
      const nominalMaxStart = Math.max(0, recipe.nominalClipSeconds - slice.plannedDuration);
      const realMaxStart = Math.max(0, clip.duration - slice.plannedDuration);
      // Proportional mapping preserves start/middle/end semantics.
      const start = nominalMaxStart > 0 ? (slice.plannedStart / nominalMaxStart) * realMaxStart : 0;
      const duration = Math.max(0.5, Math.min(slice.plannedDuration, clip.duration - start));
      materialized.push({ clipPath: clip.path, start: round1(start), duration: round1(duration) });
      if (!usedLedgerIds.includes(slice.ledgerId)) usedLedgerIds.push(slice.ledgerId);
    }
    const bgSeconds = materialized.reduce((sum, s) => sum + s.duration, 0);
    const durationSeconds = recipe.mixingEnabled
      ? round1(Math.min(recipe.durationSeconds, bgSeconds))
      : round1(recipe.durationSeconds);

    // 3) Resolve audio (lyric mode: trimmed track; quote mode: silent — v1 has no bg music).
    let audioInput: string;
    if (item.batch.mode === "lyric") {
      if (!item.track) throw new Error("Lyric item has no track");
      const audioPath = await resolveTrackAudio(item.track, tempDir);
      const trimStart = item.track.trimStart ?? 0;
      const ssOpt = trimStart > 0 ? `-ss ${trimStart.toFixed(3)} ` : "";
      audioInput = `${ssOpt}-t ${durationSeconds.toFixed(3)} -i "${audioPath}"`;
    } else {
      audioInput = `-f lavfi -t ${durationSeconds.toFixed(3)} -i anullsrc=channel_layout=stereo:sample_rate=44100`;
    }

    // 4) Overlay (cached by style+params+lyrics/quote hash, self-healing).
    const style = item.styleId
      ? await prisma.savedStyle.findUnique({ where: { id: item.styleId } })
      : null;
    if (!style) throw new Error("Item has no style (styleId missing or deleted)");
    const inputProps = await buildOverlayInputProps(style, item, recipe);
    const overlayPath = await getOrCreateFactoryOverlay({
      savedStyle: style,
      inputProps,
      durationSeconds,
      trackId: item.trackId,
    });

    // 5) Compose.
    const cmd = buildComposeCommand({
      materialized,
      mixingEnabled: recipe.mixingEnabled,
      overlayPath,
      audioInput,
      durationSeconds,
      localOutFile,
    });
    console.log(`[Factory Worker] FFmpeg item ${itemId}: ${cmd.substring(0, 400)}...`);
    await execAsync(cmd, { timeout: 300000, maxBuffer: 10 * 1024 * 1024 });

    // 6) Move into the pool (local) + offload to R2 — Multiplier-output style.
    //    NO Drive upload, NO Delivery here: distribution happens later.
    fs.copyFileSync(localOutFile, finalOutFile);
    try {
      await uploadToR2(finalOutFile, r2Key);
    } catch (r2Err) {
      // Local copy is authoritative; R2 is the durability/offload layer.
      console.warn(`[Factory Worker] R2 offload failed for item ${itemId}:`, r2Err);
    }

    // 7) Only now consume the ledger reservation.
    if (usedLedgerIds.length > 0) {
      await markFilesUsed(usedLedgerIds);
    }

    await prisma.factoryBatchItem.update({
      where: { id: itemId },
      data: { status: "COMPLETED", outputRef: publicPath, error: null },
    });
  } finally {
    // 8) Clip/audio temp always goes away; the pool render stays on disk.
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
}

async function probeDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${filePath}"`,
      { timeout: 30000 }
    );
    const d = parseFloat(stdout.trim());
    return Number.isFinite(d) && d > 0 ? d : NOMINAL_CLIP_SECONDS;
  } catch {
    return NOMINAL_CLIP_SECONDS;
  }
}

/** Resolves Track.audioRef ("local path or R2 key") to an absolute local file. */
async function resolveTrackAudio(track: Track, tempDir: string): Promise<string> {
  const ref = (track.audioRef || track.fileUrl || "").trim();
  if (!ref) throw new Error(`Track "${track.title}" has no audioRef`);
  if (ref.startsWith("/")) {
    const abs = path.join(process.cwd(), "public", ref);
    if (fs.existsSync(abs)) return abs;
    // Absolute filesystem path stored directly.
    if (fs.existsSync(ref)) return ref;
  }
  // Treat as R2 key.
  const localPath = path.join(tempDir, `audio_${track.id}.bin`);
  await downloadFromR2(ref, localPath);
  if (!fs.existsSync(localPath)) throw new Error(`Audio not found for track "${track.title}" (ref: ${ref})`);
  return localPath;
}

/** lrcData lines [{t, text}] → overlay lines [{text, start, end}] shifted to 0 within the trim window. */
export function shiftedLyricLines(track: Track): { text: string; start: number; end: number }[] {
  const raw = Array.isArray(track.lrcData) ? (track.lrcData as any[]) : [];
  const lines = raw
    .filter((l) => l && Number.isFinite(l.t))
    .map((l) => ({ text: String(l.text ?? ""), t: Number(l.t) }))
    .sort((a, b) => a.t - b.t);
  const trimStart = track.trimStart ?? 0;
  const trimEnd = track.trimEnd ?? Infinity;
  const out: { text: string; start: number; end: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].t;
    const next = i < lines.length - 1 ? lines[i + 1].t : t + 4.0;
    if (next <= trimStart || t >= trimEnd) continue;
    const start = Math.max(0, t - trimStart);
    const end = Math.min(next, trimEnd) - trimStart;
    if (end <= start) continue;
    out.push({ text: lines[i].text, start: round1(start), end: round1(end) });
  }
  return out;
}

function parseStyleParams(savedStyle: SavedStyle): Record<string, any> {
  let params: any = savedStyle.params;
  if (typeof params === "string") {
    try {
      params = JSON.parse(params);
      if (typeof params === "string") params = JSON.parse(params);
    } catch {
      params = {};
    }
  }
  return params && typeof params === "object" ? params : {};
}

async function buildOverlayInputProps(
  style: SavedStyle,
  item: { trackId: string | null; quoteText: string | null; track: Track | null; batch: FactoryBatch },
  recipe: FactoryRecipe
): Promise<Record<string, any>> {
  const props = parseStyleParams(style);
  if (item.batch.mode === "lyric") {
    if (!item.track) throw new Error("Lyric item has no track");
    const lines = shiftedLyricLines(item.track);
    if (lines.length === 0) throw new Error(`Track "${item.track.title}" has no lyric lines inside the trim window`);
    // spotify-lyrics composition consumes line-level {text, start, end} JSON.
    props.lyricsJson = JSON.stringify(lines);
    // Style Lab lyric-caption composition consumes {text, startMs, endMs}.
    props.lines = lines.map((l) => ({
      text: l.text,
      startMs: Math.round(l.start * 1000),
      endMs: Math.round(l.end * 1000),
    }));
  } else {
    props.quoteText = recipe.quoteText ?? item.quoteText ?? "";
    props.author = props.author ?? "";
  }
  return props;
}

// ── Overlay cache (OverlayCache + .ready sentinel, self-healing) ─────────────

let cachedFactoryBundle: string | null = null;

async function getOrCreateFactoryOverlay(opts: {
  savedStyle: SavedStyle;
  inputProps: Record<string, any>;
  durationSeconds: number;
  trackId: string | null;
}): Promise<string> {
  const { savedStyle, inputProps, durationSeconds, trackId } = opts;
  const hash = createHash("sha256")
    .update(JSON.stringify({ styleId: savedStyle.id, templateKey: savedStyle.templateKey, inputProps, durationSeconds: round1(durationSeconds) }))
    .digest("hex");

  const relPath = `/uploads/factory-overlays/overlay_${hash}.webm`;
  const absPath = path.join(process.cwd(), "public", relPath);
  const sentinel = absPath + ".ready";
  fs.mkdirSync(path.dirname(absPath), { recursive: true });

  const cached = await prisma.overlayCache.findUnique({ where: { hash } });
  if (cached?.readyAt && fs.existsSync(absPath) && fs.existsSync(sentinel)) {
    try {
      if (fs.statSync(absPath).size > 1024) return absPath;
    } catch {}
  }
  // Self-heal: stale DB row / missing file / missing sentinel → re-render.
  console.log(`[Factory Overlay] Cache miss for hash ${hash} (style ${savedStyle.name}). Rendering...`);

  const { bundle } = await import("@remotion/bundler");
  const { renderMedia, selectComposition } = await import("@remotion/renderer");
  const entryPoint = path.join(process.cwd(), "src", "remotion", "index.ts");
  if (!cachedFactoryBundle || !fs.existsSync(cachedFactoryBundle)) {
    cachedFactoryBundle = await bundle(entryPoint);
  }

  const composition = await selectComposition({
    serveUrl: cachedFactoryBundle,
    id: savedStyle.templateKey,
    inputProps,
  });
  // Factory durations are trim/target driven; override the registered default.
  composition.durationInFrames = Math.max(30, Math.ceil(durationSeconds * composition.fps));

  try { fs.unlinkSync(sentinel); } catch {}
  await renderMedia({
    composition,
    serveUrl: cachedFactoryBundle,
    outputLocation: absPath,
    inputProps,
    codec: "vp9", // alpha transparency for compositing
    browserExecutable: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });
  // Sentinel goes last — a concurrent reader never sees a partial render.
  fs.writeFileSync(sentinel, new Date().toISOString(), "utf-8");

  await prisma.overlayCache.upsert({
    where: { hash },
    update: { filePath: relPath, readyAt: new Date(), styleId: savedStyle.id, trackId },
    create: { hash, styleId: savedStyle.id, trackId, filePath: relPath, readyAt: new Date() },
  });

  try {
    await uploadToR2(absPath, `uploads/factory-overlays/overlay_${hash}.webm`);
  } catch (r2Err) {
    console.warn(`[Factory Overlay] R2 offload failed for ${hash}:`, r2Err);
  }
  return absPath;
}

// ── FFmpeg compose ───────────────────────────────────────────────────────────

function buildComposeCommand(opts: {
  materialized: { clipPath: string; start: number; duration: number }[];
  mixingEnabled: boolean;
  overlayPath: string;
  audioInput: string;
  durationSeconds: number;
  localOutFile: string;
}): string {
  const { materialized, mixingEnabled, overlayPath, audioInput, durationSeconds, localOutFile } = opts;
  const width = 720;
  const height = 1280;
  const inputs: string[] = [];
  let filter = "";

  let overlayIdx: number;
  if (mixingEnabled) {
    materialized.forEach((s, i) => {
      inputs.push(`-ss ${s.start.toFixed(3)} -t ${s.duration.toFixed(3)} -i "${s.clipPath}"`);
      filter += `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=30,format=yuv420p[v${i}];`;
    });
    if (materialized.length > 1) {
      filter += materialized.map((_, i) => `[v${i}]`).join("") + `concat=n=${materialized.length}:v=1:a=0[bg];`;
    } else {
      filter += `[v0]copy[bg];`;
    }
    overlayIdx = materialized.length;
  } else {
    // Whole clip, looped to fill the target duration.
    inputs.push(`-stream_loop -1 -i "${materialized[0].clipPath}"`);
    filter += `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=30,format=yuv420p[bg];`;
    overlayIdx = 1;
  }

  inputs.push(`-i "${overlayPath}"`);
  const audioIdx = overlayIdx + 1;
  inputs.push(audioInput);
  filter += `[bg][${overlayIdx}:v]overlay=0:0[v]`;

  return [
    `ffmpeg -y`,
    ...inputs,
    `-filter_complex "${filter}"`,
    `-map "[v]"`,
    `-map ${audioIdx}:a`,
    `-c:v libx264`,
    `-preset veryfast`,
    `-crf 26`,
    `-maxrate 8M`,
    `-bufsize 16M`,
    `-r 30`,
    `-pix_fmt yuv420p`,
    `-c:a aac -b:a 128k`,
    `-movflags +faststart`,
    `-t ${durationSeconds.toFixed(3)}`,
    `"${localOutFile}"`,
  ].join(" ");
}

// ── Output naming + Drive upload ─────────────────────────────────────────────

function slugify(text: string, maxLen: number): string {
  return text
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .substring(0, maxLen);
}

/** `(Campaign Title) Campaign_slug hook_slug_<itemId>.mp4` — Smart Export convention. */
async function buildOutputFileName(batch: FactoryBatch, item: { id: string; quoteText: string | null; track: Track | null }): Promise<string> {
  let campaignTitle: string | null = null;
  if (batch.campaignId) {
    const campaign = await prisma.campaign.findUnique({ where: { id: batch.campaignId }, select: { title: true, name: true } });
    campaignTitle = campaign?.title || campaign?.name || null;
  }
  const campaignPrefix = campaignTitle ? formatCampaignBracketPrefix(campaignTitle) : "";
  const campaignSlug = slugify(campaignTitle || "factory", 30);
  const hookSource =
    batch.mode === "lyric" ? item.track?.title || "lyric" : (item.quoteText || "quote").split(/\s+/).slice(0, 8).join(" ");
  const hookSlug = slugify(hookSource, 40) || "video";
  return `${campaignPrefix}${campaignSlug}_${hookSlug}_${item.id}.mp4`;
}

/** Uploads with a name-dedup guard (safe for item retries). Returns the Drive file id. */
async function uploadToOutputFolder(
  account: { id: string; driveFolderId: string | null },
  fileName: string,
  localPath: string
): Promise<string> {
  if (!account.driveFolderId) throw new Error("Account has no output Drive folder");
  const drive = await getDriveClient(account.id);

  const escaped = fileName.replace(/'/g, "\\'");
  const existing = await drive.files.list({
    q: `name = '${escaped}' and '${account.driveFolderId}' in parents and trashed = false`,
    fields: "files(id,name)",
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const found = existing.data.files?.[0];
  if (found?.id) {
    console.log(`[Factory Worker] Reusing existing Drive file ${found.id} for ${fileName}`);
    return found.id;
  }

  const res = await drive.files.create({
    requestBody: { name: fileName, parents: [account.driveFolderId] },
    media: { mimeType: "video/mp4", body: fs.createReadStream(localPath) },
    fields: "id",
    supportsAllDrives: true,
  });
  if (!res.data.id) throw new Error("Drive upload returned no file id");
  return res.data.id;
}

// ── Distribution (render-first / distribute-after) ───────────────────────────

export interface DistributeInput {
  assignments: BatchAssignment[];
  /** when true, already-distributed COMPLETED items are eligible again */
  allowRedistribute?: boolean;
}

export interface DistributeAccountResult {
  accountId: string;
  tiktokUsername: string;
  requested: number;
  assigned: number;
  uploaded: number;
  failed: number;
  deliveryId: string | null;
  warnings: string[];
}

export interface DistributeResult {
  results: DistributeAccountResult[];
  warnings: string[];
  /** COMPLETED items skipped because they were distributed in an earlier run */
  alreadyDistributed: number;
  poolSize: number;
}

function validateAssignments(assignments: BatchAssignment[]) {
  if (!Array.isArray(assignments) || assignments.length === 0) {
    throw new Error("Select at least one account");
  }
  const seen = new Set<string>();
  for (const a of assignments) {
    if (!a.accountId) throw new Error("Assignment is missing accountId");
    if (seen.has(a.accountId)) throw new Error("Each account can only appear once");
    seen.add(a.accountId);
    if (!Number.isInteger(a.videoCount) || a.videoCount < 1 || a.videoCount > 500) {
      throw new Error("videoCount must be an integer between 1 and 500");
    }
  }
}

/**
 * Deals the batch's render pool to accounts and uploads each assigned video to
 * the account's OUTPUT driveFolderId (campaign-bracket naming), then records a
 * Delivery per account.
 *
 * Fair dealing: items are bucketed by styleId and dealt with the Smart Export
 * fair round-robin mixer (≤1 item per style-bucket per account, fewest-first);
 * leftovers the mixer can't place (an account requesting more videos than
 * there are buckets) are dealt fewest-first ignoring the bucket rule, so
 * per-account counts are still met. Every item is used at most once per run.
 *
 * Double-distribution: by default only undistributed items (distributedAt null)
 * are eligible and the number skipped is reported; allowRedistribute opts back
 * in. Items are marked distributed ONLY after a successful Drive upload, and
 * the upload name-dedup guard makes retried runs idempotent.
 */
export async function distributeBatch(batchId: string, input: DistributeInput): Promise<DistributeResult> {
  const batch = await prisma.factoryBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new Error("Batch not found");
  validateAssignments(input.assignments);

  const accounts = await prisma.managedAccount.findMany({
    where: { id: { in: input.assignments.map((a) => a.accountId) } },
  });
  if (accounts.length !== input.assignments.length) throw new Error("One or more accounts were not found");
  const accountMap = new Map(accounts.map((a) => [a.id, a]));

  const alreadyDistributed = await prisma.factoryBatchItem.count({
    where: { batchId, status: "COMPLETED", distributedAt: { not: null } },
  });

  const pool = await prisma.factoryBatchItem.findMany({
    where: {
      batchId,
      status: "COMPLETED",
      ...(input.allowRedistribute ? {} : { distributedAt: null }),
    },
    include: { track: true },
    orderBy: { createdAt: "asc" },
  });

  if (pool.length === 0) {
    throw new Error(
      alreadyDistributed > 0
        ? `No undistributed videos left in the pool — all ${alreadyDistributed} completed videos were already distributed. Enable re-distribute to send them again.`
        : "No completed videos available to distribute"
    );
  }

  const warnings: string[] = [];
  if (alreadyDistributed > 0 && !input.allowRedistribute) {
    warnings.push(`${alreadyDistributed} videos were already distributed and are skipped this run.`);
  }
  const totalRequested = input.assignments.reduce((s, a) => s + a.videoCount, 0);
  if (totalRequested > pool.length) {
    warnings.push(`Requested ${totalRequested} videos but only ${pool.length} are in the pool — some accounts will get fewer.`);
  }

  // Fair dealing: bucket by style, mixer first, leftovers fewest-first.
  const byBucket = new Map<string, typeof pool>();
  for (const item of pool) {
    const key = item.styleId ?? "none";
    const list = byBucket.get(key) ?? [];
    list.push(item);
    byBucket.set(key, list);
  }
  for (const list of byBucket.values()) shuffleInPlace(list);

  const folders = input.assignments.map((a) => ({
    id: a.accountId,
    name: accountMap.get(a.accountId)?.tiktokUsername ?? a.accountId,
    count: a.videoCount,
  }));
  const mixed = assignVideosFairRoundRobin(
    [...byBucket.keys()],
    Object.fromEntries([...byBucket.entries()].map(([k, v]) => [k, v.map((i) => i.id)])),
    folders
  );

  const assignedByAccount = new Map<string, string[]>(mixed.assignments.map((a) => [a.driveFolderId, a.videoIds]));
  const assignedIds = new Set(mixed.assignments.flatMap((a) => a.videoIds));
  const leftovers = pool.filter((i) => !assignedIds.has(i.id)).map((i) => i.id);

  // Second pass: meet per-account counts from the leftover pile, fewest-first.
  const needed = new Map<string, number>(
    input.assignments.map((a) => [a.accountId, a.videoCount - (assignedByAccount.get(a.accountId)?.length ?? 0)])
  );
  for (const leftoverId of leftovers) {
    let target: string | null = null;
    for (const [accountId, need] of needed) {
      if (need <= 0) continue;
      if (target === null || need > (needed.get(target) ?? 0)) target = accountId;
    }
    if (!target) break;
    assignedByAccount.get(target)!.push(leftoverId);
    needed.set(target, (needed.get(target) ?? 0) - 1);
  }
  for (const u of mixed.unfulfillable) {
    const stillShort = needed.get(u.driveFolderId) ?? 0;
    if (stillShort > 0) {
      warnings.push(`@${u.driveFolderName}: requested ${u.requestedCount}, assigned ${u.requestedCount - stillShort} — pool exhausted.`);
    }
  }

  const itemMap = new Map(pool.map((i) => [i.id, i]));
  const results: DistributeAccountResult[] = [];

  for (const assignment of input.assignments) {
    const account = accountMap.get(assignment.accountId)!;
    const accWarnings: string[] = [];
    const itemIds = assignedByAccount.get(assignment.accountId) ?? [];
    const uploadedFiles: { name: string; driveFileId?: string }[] = [];
    let failed = 0;
    let deliveryId: string | null = null;

    if (itemIds.length > 0 && !account.driveFolderId) {
      accWarnings.push(`@${account.tiktokUsername} has no output Drive folder — ${itemIds.length} assigned videos skipped.`);
      failed = itemIds.length;
    } else {
      for (const itemId of itemIds) {
        const item = itemMap.get(itemId)!;
        try {
          // Resolve the pool file (local first, R2 fallback).
          if (!item.outputRef) throw new Error("Item has no render output");
          const { r2Key } = renderRefForItem(item.id);
          const absPath = path.join(process.cwd(), "public", item.outputRef);
          if (!fs.existsSync(absPath)) {
            await downloadFromR2(r2Key, absPath);
          }
          if (!fs.existsSync(absPath)) throw new Error("Render file missing locally and in R2");

          const fileName = await buildOutputFileName(batch, item);
          const driveFileId = await uploadToOutputFolder(account, fileName, absPath);

          await prisma.factoryBatchItem.update({
            where: { id: item.id },
            data: {
              distributedAt: new Date(),
              distributedToAccountId: account.id,
              outputDriveFileId: driveFileId,
            },
          });
          uploadedFiles.push({ name: fileName, driveFileId });
        } catch (upErr: any) {
          failed++;
          accWarnings.push(`@${account.tiktokUsername}: ${String(upErr?.message ?? upErr).slice(0, 200)}`);
        }
      }

      if (uploadedFiles.length > 0) {
        try {
          const delivery = await createDelivery({
            accountId: account.id,
            campaignId: batch.campaignId,
            batchId,
            videoCount: uploadedFiles.length,
            fileList: uploadedFiles,
            outputFolderId: account.driveFolderId,
            // Simple rule: wired to PostPeer (and active) → auto-posts.
            postingMode: account.postpeerAccountId && account.isActive ? "auto_post" : "manual",
          });
          deliveryId = delivery.id;
        } catch (delErr) {
          // Delivery tracking must never fail the distribution.
          console.error(`[Factory Distribute] createDelivery failed for account ${account.id}:`, delErr);
          accWarnings.push(`@${account.tiktokUsername}: uploaded ${uploadedFiles.length} videos but recording the delivery failed.`);
        }
      }
    }

    results.push({
      accountId: account.id,
      tiktokUsername: account.tiktokUsername,
      requested: assignment.videoCount,
      assigned: itemIds.length,
      uploaded: uploadedFiles.length,
      failed,
      deliveryId,
      warnings: accWarnings,
    });
    console.log(`[Factory Distribute] @${account.tiktokUsername}: ${uploadedFiles.length}/${itemIds.length} uploaded`);
  }

  return { results, warnings, alreadyDistributed, poolSize: pool.length };
}

// ── Smart Download (multiplier pattern: status JSON + background tar prep) ───

export interface FactoryDownloadStatus {
  status: "PREPARING" | "COMPLETED" | "FAILED";
  progress: number;
  message: string;
  downloadUrl: string | null;
  size: number;
  completedCount: number;
  timestamp: number;
  error?: string | null;
}

function factoryArchivePaths(batchId: string) {
  const archivesDir = path.join(process.cwd(), "public", ARCHIVE_DIR_PUBLIC);
  const archiveName = `factory_${batchId}_archive.tar`;
  return {
    archivesDir,
    archiveName,
    archivePath: path.join(archivesDir, archiveName),
    statusPath: path.join(archivesDir, `status_${batchId}.json`),
  };
}

/**
 * Status-protocol entry point (mirrors /api/managed/multiplier/download):
 * returns the current status JSON, kicking off a background archive prep when
 * there is none, it is stale (>10 min PREPARING), the completed count changed,
 * the archive vanished, or `force` is set.
 */
export async function getFactoryDownloadStatus(batchId: string, force = false): Promise<FactoryDownloadStatus> {
  const batch = await prisma.factoryBatch.findUnique({ where: { id: batchId }, select: { id: true } });
  if (!batch) throw new Error("Batch not found");

  const completedCount = await prisma.factoryBatchItem.count({
    where: { batchId, status: "COMPLETED" },
  });
  if (completedCount === 0) {
    throw new Error("No completed videos available for download");
  }

  const { archivesDir, archivePath, statusPath } = factoryArchivePaths(batchId);
  let startPrep = false;
  let statusData: FactoryDownloadStatus | null = null;

  if (fs.existsSync(statusPath)) {
    try {
      statusData = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
    } catch {
      startPrep = true;
    }
  } else {
    startPrep = true;
  }

  if (force || (statusData && statusData.completedCount !== completedCount)) startPrep = true;
  if (statusData?.status === "PREPARING" && Date.now() - statusData.timestamp > 10 * 60 * 1000) startPrep = true;
  if (statusData?.status === "COMPLETED" && !fs.existsSync(archivePath)) startPrep = true;

  if (startPrep) {
    fs.mkdirSync(archivesDir, { recursive: true });
    statusData = {
      status: "PREPARING",
      progress: 0,
      message: "Initializing archive preparation...",
      downloadUrl: null,
      size: 0,
      completedCount,
      timestamp: Date.now(),
    };
    fs.writeFileSync(statusPath, JSON.stringify(statusData, null, 2));
    prepareFactoryArchive(batchId, completedCount).catch((err) => {
      console.error(`[Factory Download] Background prep failed for ${batchId}:`, err);
    });
  }

  return statusData!;
}

async function prepareFactoryArchive(batchId: string, completedCount: number): Promise<void> {
  const { archivesDir, archiveName, archivePath, statusPath } = factoryArchivePaths(batchId);
  const linkDir = path.join(archivesDir, `dl_${batchId}`);

  const updateStatus = async (data: Partial<FactoryDownloadStatus>) => {
    try {
      const current = fs.existsSync(statusPath) ? JSON.parse(fs.readFileSync(statusPath, "utf-8")) : {};
      fs.writeFileSync(
        statusPath,
        JSON.stringify(
          {
            status: "PREPARING",
            progress: 0,
            message: "",
            downloadUrl: null,
            size: 0,
            completedCount,
            timestamp: Date.now(),
            ...current,
            ...data,
          },
          null,
          2
        )
      );
    } catch (err) {
      console.error("[Factory Download] Error writing status file:", err);
    }
  };

  try {
    await updateStatus({ status: "PREPARING", progress: 5, message: "Collecting videos..." });

    const items = await prisma.factoryBatchItem.findMany({
      where: { batchId, status: "COMPLETED" },
      include: { track: true },
      orderBy: { createdAt: "asc" },
    });

    const filePaths: { absPath: string; name: string }[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.outputRef) continue;
      const absPath = path.join(process.cwd(), "public", item.outputRef);
      if (!fs.existsSync(absPath)) {
        await downloadFromR2(renderRefForItem(item.id).r2Key, absPath);
      }
      if (fs.existsSync(absPath)) {
        const hookSource = item.track?.title || (item.quoteText || "video").split(/\s+/).slice(0, 8).join(" ");
        filePaths.push({
          absPath,
          name: `${String(i + 1).padStart(3, "0")}_${slugify(hookSource, 40) || "video"}.mp4`,
        });
      }
    }
    if (filePaths.length === 0) throw new Error("Rendered video files not found on disk or in R2");

    if (fs.existsSync(linkDir)) fs.rmSync(linkDir, { recursive: true });
    fs.mkdirSync(linkDir, { recursive: true });

    for (let i = 0; i < filePaths.length; i++) {
      fs.copyFileSync(filePaths[i].absPath, path.join(linkDir, filePaths[i].name));
      await updateStatus({
        status: "PREPARING",
        progress: Math.round(15 + (i / filePaths.length) * 35),
        message: `Copying video ${i + 1} of ${filePaths.length}...`,
      });
    }

    await updateStatus({ status: "PREPARING", progress: 60, message: "Packaging into tar archive..." });
    await new Promise<void>((resolve, reject) => {
      exec(`tar -cf "${archivePath}" -C "${linkDir}" .`, { maxBuffer: 200 * 1024 * 1024 }, (err, _, stderr) => {
        try { fs.rmSync(linkDir, { recursive: true }); } catch {}
        if (err) reject(new Error(`tar failed: ${stderr}`));
        else resolve();
      });
    });

    if (!fs.existsSync(archivePath)) throw new Error("tar completed but archive file not found on disk");

    await uploadToR2(archivePath, `uploads/factory/archives/${archiveName}`);
    const size = fs.statSync(archivePath).size;

    await updateStatus({
      status: "COMPLETED",
      progress: 100,
      message: "Archive prepared successfully!",
      downloadUrl: `${ARCHIVE_DIR_PUBLIC}/${archiveName}`,
      size,
    });
    console.log(`[Factory Download] Archive ready for batch ${batchId} (${(size / 1024 / 1024).toFixed(1)}MB)`);
  } catch (err: any) {
    console.error(`[Factory Download] Failed to prepare archive for ${batchId}:`, err);
    try { if (fs.existsSync(linkDir)) fs.rmSync(linkDir, { recursive: true }); } catch {}
    try { if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath); } catch {}
    await updateStatus({ status: "FAILED", progress: 100, message: err.message || String(err), error: err.message || String(err) });
  }
}

// ── Ledger stats passthrough (used by routes for account enrichment) ─────────

export { getLedgerStats };
