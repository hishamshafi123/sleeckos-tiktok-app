import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { clearGroupOutputs, deleteGroups } from "@/lib/services/multiplier";

// POST /api/multiplier/groups/bulk-delete
// Body: { groupIds: string[]; mode: "outputs" | "full" }
//   outputs — delete only rendered videos (files + rows); groups stay in the builder as DRAFT
//   full    — delete the groups entirely (source videos, outputs, hooks, DB rows)
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { groupIds, mode } = await req.json();

    if (!groupIds || !Array.isArray(groupIds) || groupIds.length === 0) {
      return NextResponse.json({ error: "Missing groupIds" }, { status: 400 });
    }
    if (mode !== "outputs" && mode !== "full") {
      return NextResponse.json({ error: "mode must be 'outputs' or 'full'" }, { status: 400 });
    }

    const result = mode === "outputs"
      ? await clearGroupOutputs(groupIds)
      : await deleteGroups(groupIds);

    return NextResponse.json({ success: true, mode, ...result });
  } catch (err: any) {
    console.error("[Multiplier Bulk Delete API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to delete groups" }, { status: 500 });
  }
}
