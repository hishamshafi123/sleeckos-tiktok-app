export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { generateAiDraftTemplate, listAiDrafts } from "@/lib/services/style-lab";
import type { StyleFamily } from "@/lib/style-lab/schema";

export const maxDuration = 120;

// GET /api/style-lab/drafts — list AI draft templates (drafts shelf payload).
export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "style_studio"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const drafts = await listAiDrafts();
    return NextResponse.json(drafts);
  } catch (err: any) {
    console.error("[Style Lab Drafts GET] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to load drafts" }, { status: 500 });
  }
}

// POST /api/style-lab/drafts — ADMIN ONLY.
// Body: { description, family } — Gemini designs a LAYERED style (layer
// stack + canvas params, never raw code) which is strictly validated and
// persisted as a draft StyleTemplate row for the gallery's drafts shelf.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { description, family } = body;
    if (!description || typeof description !== "string") {
      return NextResponse.json({ error: "Description is required" }, { status: 400 });
    }
    const fam: StyleFamily = family === "quote" ? "quote" : "lyric";

    const draft = await generateAiDraftTemplate({
      description,
      family: fam,
      createdBy: session.userId,
    });
    return NextResponse.json(draft, { status: 201 });
  } catch (err: any) {
    console.error("[Style Lab Drafts POST] Error:", err);
    const msg = err?.message ?? "AI draft generation failed";
    const status = /GEMINI_API_KEY|required|validation|unparseable/i.test(msg) ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
