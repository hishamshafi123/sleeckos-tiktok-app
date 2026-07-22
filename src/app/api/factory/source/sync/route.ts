export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { parseDriveFolderId } from "@/lib/google";
import { syncFolderById, getFolderLedgerStats } from "@/lib/services/drive-ledger";

/**
 * POST /api/factory/source/sync — validate + names-only sync of a pasted Drive
 * source folder into the per-folder ledger (rows get accountId = null).
 * Uses the master-OAuth → service-account chain, NOT a specific account.
 * Body: { folderId: string }  (folder URL or bare ID)
 * Returns: { total, added, missing, unchanged, folderName, unused, used, folderId }
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
    const parsed = parseDriveFolderId(String(body.folderId ?? ""));
    if (!parsed) {
      return NextResponse.json(
        { error: "Could not parse a Drive folder ID — paste a folder URL or bare ID" },
        { status: 400 }
      );
    }

    const result = await syncFolderById(parsed, null);
    const stats = await getFolderLedgerStats(parsed);

    return NextResponse.json({
      folderId: parsed,
      folderName: result.folderName,
      total: result.total,
      added: result.added,
      missing: result.missing,
      unchanged: result.unchanged,
      unused: stats.unused,
      used: stats.used,
    });
  } catch (err: any) {
    console.error("[Factory Source Sync] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to sync folder" }, { status: 400 });
  }
}
