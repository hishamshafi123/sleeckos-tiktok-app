/**
 * Drive Ledger — names-only usage ledger for an account's INPUT Drive folder
 * (ManagedAccount.inputDriveFolderId). Files are never downloaded here; the
 * ledger only records names/ids and per-file usage so the Video Factory can
 * pick background clips without repeats until the pool is exhausted.
 *
 * The OUTPUT/posting folder remains ManagedAccount.driveFolderId — untouched.
 */
import prisma from "../db";
import { getDriveClient } from "../google";
import type { DriveFile } from "@prisma/client";

export interface ConnectResult {
  inputFolderId: string;
  inputFolderName: string;
}

export interface SyncResult {
  total: number;      // live files seen in the folder listing
  added: number;      // new ledger rows created
  missing: number;    // existing rows newly marked missing
  unchanged: number;  // rows present before and after
}

export interface SelectResult {
  files: DriveFile[];
  exhausted: boolean;      // true when `count` exceeds the unused pool
  availableUnused: number; // rows with timesUsed = 0 (and not missing)
}

export interface LedgerStats {
  total: number;
  unused: number;
  used: number;
  missing: number;
}

async function requireAccount(accountId: string) {
  const account = await prisma.managedAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new Error("Account not found");
  return account;
}

/** JSON-safe shape (BigInt size -> number). */
export function serializeDriveFile(file: DriveFile) {
  return {
    ...file,
    size: file.size === null ? null : Number(file.size),
  };
}

/**
 * Validates that inputFolderId resolves to a real Drive folder and stores it
 * as the account's input (background source clips) folder.
 */
export async function connectAccountDrives(
  accountId: string,
  { inputFolderId }: { inputFolderId: string },
): Promise<ConnectResult> {
  if (!inputFolderId || !inputFolderId.trim()) {
    throw new Error("inputFolderId is required");
  }
  await requireAccount(accountId);

  const drive = await getDriveClient(accountId, true);
  const res = await drive.files.get({
    fileId: inputFolderId.trim(),
    fields: "id,name,mimeType,trashed",
    supportsAllDrives: true,
  });

  const meta = res.data;
  if (meta.mimeType !== "application/vnd.google-apps.folder") {
    throw new Error("The provided ID is not a Google Drive folder");
  }
  if (meta.trashed) {
    throw new Error("The provided folder is in the trash");
  }

  await prisma.managedAccount.update({
    where: { id: accountId },
    data: { inputDriveFolderId: meta.id! },
  });

  return { inputFolderId: meta.id!, inputFolderName: meta.name ?? "" };
}

/**
 * Names-only sync of the account's input folder into the DriveFile ledger.
 * - New files appear as `unused`.
 * - Ledger rows absent from the listing become `missing` (history kept).
 * - Rows that reappear are restored (`unused`/`used` per timesUsed).
 */
export async function syncDriveFolder(accountId: string): Promise<SyncResult> {
  const account = await requireAccount(accountId);
  if (!account.inputDriveFolderId) {
    throw new Error("Account has no input Drive folder connected");
  }
  const folderId = account.inputDriveFolderId;
  const drive = await getDriveClient(accountId, true);

  // Paginated listing, names/metadata only — no downloads.
  const liveFiles: { id: string; name: string; size?: string | null; mimeType?: string | null }[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id,name,size,mimeType,trashed)",
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const f of res.data.files ?? []) {
      if (!f.id || f.trashed) continue;
      liveFiles.push({ id: f.id, name: f.name ?? "", size: f.size, mimeType: f.mimeType });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  const existing = await prisma.driveFile.findMany({
    where: { accountId, folderId },
  });
  const existingByDriveId = new Map(existing.map((r) => [r.driveFileId, r]));
  const liveIds = new Set(liveFiles.map((f) => f.id));

  // 1) New rows
  const newFiles = liveFiles.filter((f) => !existingByDriveId.has(f.id));
  if (newFiles.length > 0) {
    await prisma.driveFile.createMany({
      data: newFiles.map((f) => ({
        accountId,
        folderId,
        driveFileId: f.id,
        name: f.name,
        size: f.size ? BigInt(f.size) : null,
        mimeType: f.mimeType ?? null,
        status: "unused",
      })),
      skipDuplicates: true,
    });
  }

  // 2) Newly missing (present in ledger, absent from listing)
  const newlyMissingIds = existing
    .filter((r) => !liveIds.has(r.driveFileId) && r.status !== "missing")
    .map((r) => r.id);
  if (newlyMissingIds.length > 0) {
    await prisma.driveFile.updateMany({
      where: { id: { in: newlyMissingIds } },
      data: { status: "missing" },
    });
  }

  // 3) Reappeared rows: restore status from usage
  const reappeared = existing.filter((r) => liveIds.has(r.driveFileId) && r.status === "missing");
  const reappearedUsed = reappeared.filter((r) => r.timesUsed > 0).map((r) => r.id);
  const reappearedUnused = reappeared.filter((r) => r.timesUsed === 0).map((r) => r.id);
  if (reappearedUsed.length > 0) {
    await prisma.driveFile.updateMany({
      where: { id: { in: reappearedUsed } },
      data: { status: "used" },
    });
  }
  if (reappearedUnused.length > 0) {
    await prisma.driveFile.updateMany({
      where: { id: { in: reappearedUnused } },
      data: { status: "unused" },
    });
  }

  // 4) Refresh name/size/mimeType for rows whose metadata changed
  for (const f of liveFiles) {
    const row = existingByDriveId.get(f.id);
    if (!row) continue;
    const size = f.size ? BigInt(f.size) : null;
    if (row.name !== f.name || row.size !== size || row.mimeType !== (f.mimeType ?? null)) {
      await prisma.driveFile.update({
        where: { id: row.id },
        data: { name: f.name, size, mimeType: f.mimeType ?? null },
      });
    }
  }

  await prisma.managedAccount.update({
    where: { id: accountId },
    data: { lastDriveSyncAt: new Date() },
  });

  return {
    total: liveFiles.length,
    added: newFiles.length,
    missing: newlyMissingIds.length,
    unchanged: liveFiles.length - newFiles.length,
  };
}

/** Fisher–Yates shuffle (returns a new array). */
function shuffled<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Picks up to `count` ledger files: timesUsed = 0 first (randomized), then
 * least-used tiers ascending (randomized within tier). Never returns the same
 * file twice; excludes `missing`. Only call markFilesUsed AFTER a successful render.
 */
export async function selectUnusedFiles(accountId: string, count: number): Promise<SelectResult> {
  if (count <= 0) {
    return { files: [], exhausted: false, availableUnused: 0 };
  }
  const rows = await prisma.driveFile.findMany({
    where: { accountId, status: { not: "missing" } },
    orderBy: [{ timesUsed: "asc" }, { name: "asc" }],
  });

  // Group into usage tiers (ascending), shuffle within each tier.
  const tiers = new Map<number, DriveFile[]>();
  for (const row of rows) {
    const tier = tiers.get(row.timesUsed) ?? [];
    tier.push(row);
    tiers.set(row.timesUsed, tier);
  }

  const files: DriveFile[] = [];
  for (const tier of [...tiers.keys()].sort((a, b) => a - b)) {
    if (files.length >= count) break;
    files.push(...shuffled(tiers.get(tier)!).slice(0, count - files.length));
  }

  const availableUnused = rows.filter((r) => r.timesUsed === 0).length;
  return { files, exhausted: count > availableUnused, availableUnused };
}

/** Increments usage counters — call ONLY after a successful render. */
export async function markFilesUsed(fileIds: string[]): Promise<number> {
  if (fileIds.length === 0) return 0;
  const res = await prisma.driveFile.updateMany({
    where: { id: { in: fileIds } },
    data: { timesUsed: { increment: 1 }, lastUsedAt: new Date(), status: "used" },
  });
  return res.count;
}

/** Resets usage for all non-missing ledger rows of an account. */
export async function resetUsage(accountId: string): Promise<number> {
  const res = await prisma.driveFile.updateMany({
    where: { accountId, status: { not: "missing" } },
    data: { timesUsed: 0, lastUsedAt: null, status: "unused" },
  });
  return res.count;
}

/** Marks a single ledger file back to unused. */
export async function markFileUnused(fileId: string): Promise<void> {
  await prisma.driveFile.update({
    where: { id: fileId },
    data: { timesUsed: 0, lastUsedAt: null, status: "unused" },
  });
}

export async function getLedgerStats(accountId: string): Promise<LedgerStats> {
  const grouped = await prisma.driveFile.groupBy({
    by: ["status"],
    where: { accountId },
    _count: { _all: true },
  });
  const stats: LedgerStats = { total: 0, unused: 0, used: 0, missing: 0 };
  for (const g of grouped) {
    const n = g._count._all;
    stats.total += n;
    if (g.status === "unused") stats.unused = n;
    else if (g.status === "used") stats.used = n;
    else if (g.status === "missing") stats.missing = n;
  }
  return stats;
}

export async function listLedgerFiles(
  accountId: string,
  { status }: { status?: string } = {},
): Promise<DriveFile[]> {
  return prisma.driveFile.findMany({
    where: { accountId, ...(status ? { status } : {}) },
    orderBy: { name: "asc" },
  });
}
