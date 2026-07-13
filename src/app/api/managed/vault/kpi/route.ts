import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getKpiSummary, getLeaderboard } from "@/lib/services/kpi";
import { getFolderPermission } from "@/lib/services/vault";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const range = (searchParams.get("range") || "all") as "day" | "week" | "month" | "all";
  const folderId = searchParams.get("folderId") || undefined;
  const employeeId = searchParams.get("employeeId") || undefined;
  const fromStr = searchParams.get("from");
  const toStr = searchParams.get("to");

  if (folderId) {
    const folderPermission = await getFolderPermission(session.userId, folderId);
    if (!folderPermission) {
      return NextResponse.json({ error: "Forbidden: Folder access denied" }, { status: 403 });
    }
  }

  try {
    const from = fromStr ? new Date(fromStr) : undefined;
    const to = toStr ? new Date(toStr) : undefined;

    const summary = await getKpiSummary({ from, to, folderId, employeeId });
    const leaderboard = await getLeaderboard(range, folderId);

    return NextResponse.json({ summary, leaderboard });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load KPI data" }, { status: 500 });
  }
}
