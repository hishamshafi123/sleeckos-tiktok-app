export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { generateAiVariant } from "@/lib/services/style-lab";
import type { StyleFamily } from "@/lib/style-lab/schema";

// POST /api/style-lab/ai-variant
// Body: { description, family } — Gemini translates the creative direction
// into a validated param-set variant of the family's base template and
// stores it as a SavedStyle (v1: params only, no new compositions).
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
    const { description, family } = body;
    if (!description || typeof description !== "string") {
      return NextResponse.json({ error: "Description is required" }, { status: 400 });
    }
    const fam: StyleFamily = family === "quote" ? "quote" : "lyric";

    const style = await generateAiVariant({
      description,
      family: fam,
      createdBy: session.userId,
    });
    return NextResponse.json(style, { status: 201 });
  } catch (err: any) {
    console.error("[Style Lab AI Variant POST] Error:", err);
    const msg = err?.message ?? "AI variant generation failed";
    const status = /GEMINI_API_KEY|required|Unknown param|unparseable|invalid/.test(msg) ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
