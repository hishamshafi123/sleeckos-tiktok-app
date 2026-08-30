export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { getMergedFontManifest } from "@/lib/services/custom-fonts";

// GET /api/style-lab/fonts/custom — merged manifest (bundled FONT_MANIFEST +
// runtime-installed custom fonts). Same shape as GET /api/style-lab/fonts,
// plus slug/source per entry, so the existing UI can consume it directly.
export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "style_studio"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    return NextResponse.json(await getMergedFontManifest());
  } catch (err: any) {
    console.error("[Style Lab Custom Fonts GET] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to load fonts" }, { status: 500 });
  }
}
