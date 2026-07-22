export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { getFontManifest } from "@/lib/services/style-lab";

// GET /api/style-lab/fonts — FONT_MANIFEST for the control panel
// (families + per-family weight/italic lists used to filter the weight select).
export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "style_studio"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    return NextResponse.json(getFontManifest());
  } catch (err: any) {
    console.error("[Style Lab Fonts GET] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to load fonts" }, { status: 500 });
  }
}
