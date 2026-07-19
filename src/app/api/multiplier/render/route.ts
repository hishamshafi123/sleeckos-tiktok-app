import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { bulkRenderGroups } from "@/lib/services/multiplier";

// POST /api/multiplier/render — queue renders for many groups at once
// Body: { groupIds: string[] }
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { groupIds } = await req.json();

    if (!groupIds || !Array.isArray(groupIds) || groupIds.length === 0) {
      return NextResponse.json({ error: "Missing groupIds" }, { status: 400 });
    }

    const result = await bulkRenderGroups(groupIds);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[Multiplier Bulk Render API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to queue renders" }, { status: 500 });
  }
}
