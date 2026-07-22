export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { duplicateSavedStyle } from "@/lib/services/style-lab";

// POST /api/style-lab/saved-styles/[id]/duplicate — "Duplicate & tweak".
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "style_studio"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const copy = await duplicateSavedStyle(id, session.userId);
    return NextResponse.json(copy, { status: 201 });
  } catch (err: any) {
    console.error("[Style Lab Duplicate POST] Error:", err);
    const status = (err?.message ?? "").includes("not found") ? 404 : 500;
    return NextResponse.json({ error: err.message || "Failed to duplicate style" }, { status });
  }
}
