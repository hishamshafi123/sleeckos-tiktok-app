export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { searchDriveFolders } from "@/lib/services/multiplier-export";

// GET /api/managed/multiplier/smart-export/folders?q=search
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const q = req.nextUrl.searchParams.get("q") || "";

  try {
    const folders = await searchDriveFolders(q);
    return NextResponse.json({ folders });
  } catch (err: any) {
    console.error("[Smart Export Folders Route] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to search folders" }, { status: 500 });
  }
}
