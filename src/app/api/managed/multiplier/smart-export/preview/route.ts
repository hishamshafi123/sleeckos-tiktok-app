import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { previewSmartExport } from "@/lib/services/multiplier-export";

// POST /api/managed/multiplier/smart-export/preview
// Body: { groupIds: string[], folderCounts: { id: string, name: string, count: number }[], includeExported?: boolean }
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { groupIds, folderCounts, includeExported } = body;

    if (!groupIds || !Array.isArray(groupIds) || groupIds.length === 0) {
      return NextResponse.json({ error: "Missing selected Group IDs" }, { status: 400 });
    }
    if (!folderCounts || !Array.isArray(folderCounts)) {
      return NextResponse.json({ error: "Missing folder allocations" }, { status: 400 });
    }

    const preview = await previewSmartExport(groupIds, folderCounts, !!includeExported);
    return NextResponse.json(preview);
  } catch (err: any) {
    console.error("[Smart Export Preview Route] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to generate preview" }, { status: 500 });
  }
}
