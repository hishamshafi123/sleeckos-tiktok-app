export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { parseDriveFolderId } from "@/lib/google";
import { syncFolderById, getFolderLedgerStats } from "@/lib/services/drive-ledger";

interface FolderSyncOutcome {
  folderId: string | null;
  folderName: string | null;
  total: number;
  unused: number;
  used: number;
  added: number;
  missing: number;
  error?: string;
}

/**
 * POST /api/factory/source/sync — validate + names-only sync of one or more
 * pasted Drive source folders into the per-folder ledger (rows get
 * accountId = null). Uses the master-OAuth → service-account chain, NOT a
 * specific account. One folder's failure never fails the rest.
 * Body: { folderIds?: string[], folderId?: string }  (URLs or bare IDs)
 * Returns: { folders: [{ folderId, folderName, total, unused, used, added, missing, error? }] }
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "composer"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const raw = [
      ...(Array.isArray(body.folderIds) ? body.folderIds : []),
      ...(body.folderId ? [body.folderId] : []),
    ]
      .map((v) => String(v ?? "").trim())
      .filter(Boolean)
      .slice(0, 20);

    if (raw.length === 0) {
      return NextResponse.json({ error: "Provide folderIds (or a single folderId)" }, { status: 400 });
    }

    const folders: FolderSyncOutcome[] = [];
    for (const entry of raw) {
      const parsed = parseDriveFolderId(entry);
      if (!parsed) {
        folders.push({
          folderId: null,
          folderName: null,
          total: 0,
          unused: 0,
          used: 0,
          added: 0,
          missing: 0,
          error: `Could not parse a Drive folder ID from "${entry.slice(0, 80)}"`,
        });
        continue;
      }
      try {
        const result = await syncFolderById(parsed, null);
        const stats = await getFolderLedgerStats(parsed);
        folders.push({
          folderId: parsed,
          folderName: result.folderName,
          total: result.total,
          unused: stats.unused,
          used: stats.used,
          added: result.added,
          missing: result.missing,
        });
      } catch (err: any) {
        folders.push({
          folderId: parsed,
          folderName: null,
          total: 0,
          unused: 0,
          used: 0,
          added: 0,
          missing: 0,
          error: String(err?.message ?? err).slice(0, 300),
        });
      }
    }

    return NextResponse.json({ folders });
  } catch (err: any) {
    console.error("[Factory Source Sync] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to sync folders" }, { status: 500 });
  }
}
