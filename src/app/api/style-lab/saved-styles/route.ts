export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import {
  createSavedStyle,
  generateSavedStyleThumbnail,
  listSavedStyles,
} from "@/lib/services/style-lab";
import type { StyleFamily } from "@/lib/style-lab/schema";

// GET /api/style-lab/saved-styles?family=lyric|quote
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "style_studio")) && !(await can(session.userId, "composer"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const familyParam = req.nextUrl.searchParams.get("family");
    const family: StyleFamily | undefined =
      familyParam === "lyric" || familyParam === "quote" ? familyParam : undefined;
    const styles = await listSavedStyles(family);
    return NextResponse.json(styles);
  } catch (err: any) {
    console.error("[Style Lab Saved Styles GET] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to load saved styles" }, { status: 500 });
  }
}

// POST /api/style-lab/saved-styles
// Body: { templateKey, name, params, tags? }
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
    const { templateKey, name, params, tags } = body;
    if (!templateKey || !name || !params) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const style = await createSavedStyle({
      templateKey,
      name,
      params,
      tags: Array.isArray(tags) ? tags : [],
      createdBy: session.userId,
    });

    // Server-side thumbnail in the background (survives the response because
    // the app runs as a long-lived Node process).
    void generateSavedStyleThumbnail(style.id).catch(() => undefined);

    return NextResponse.json(style, { status: 201 });
  } catch (err: any) {
    console.error("[Style Lab Saved Styles POST] Error:", err);
    const status = /Unknown Style Lab template|Unknown param/.test(err?.message ?? "") ? 400 : 500;
    return NextResponse.json({ error: err.message || "Failed to save style" }, { status });
  }
}
