import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { retryExportAssignment } from "@/lib/services/multiplier-export";

// POST /api/managed/multiplier/smart-export/assignments/[id]/retry
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const result = await retryExportAssignment(id);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[Smart Export Assignment Retry Route] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to retry assignment upload" }, { status: 500 });
  }
}
