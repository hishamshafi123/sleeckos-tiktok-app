export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { getStyleLabTemplates } from "@/lib/services/style-lab";

// GET /api/style-lab/templates — gallery payload: all Style Lab templates
// (base + brat + imported) with family, defaultParams, thumbnail and
// hover-preview URLs. Rows are self-seeded on first call.
export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "style_studio"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const templates = await getStyleLabTemplates();
    return NextResponse.json(templates);
  } catch (err: any) {
    console.error("[Style Lab Templates GET] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to load templates" }, { status: 500 });
  }
}
