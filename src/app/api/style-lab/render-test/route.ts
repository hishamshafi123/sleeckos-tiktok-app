export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { renderTestSample, type TestRenderFormat } from "@/lib/services/style-lab";

export const maxDuration = 300;

// POST /api/style-lab/render-test
// Body: { templateKey, params, layers?, format? } — format "video" (default,
// ~3s clip) or "still". When layers is a non-empty stack the render goes
// through the layered-style composition. Renders into
// public/uploads/style-lab/ and returns { url }.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "style_studio"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { templateKey, params, layers, format } = body;
    if (!templateKey || !params) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    const fmt: TestRenderFormat = format === "still" ? "still" : "video";

    const result = await renderTestSample({
      templateKey,
      params,
      ...(layers !== undefined ? { layers } : {}),
      format: fmt,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[Style Lab Render Test POST] Error:", err);
    const status = /Unknown Style Lab template|Unknown param/.test(err?.message ?? "") ? 400 : 500;
    return NextResponse.json({ error: err.message || "Test render failed" }, { status });
  }
}
