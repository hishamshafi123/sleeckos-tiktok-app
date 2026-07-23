export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { validateDraftTemplate } from "@/lib/services/style-lab";

export const maxDuration = 300;

// POST /api/style-lab/drafts/[id]/validate — ADMIN ONLY.
// Runs the draft gate: (a) schema coerces, (b) transparency invariant
// (explicit bgColor), (c) still + 2s webm render through the real render
// path (with the alpha assertion for transparent overlays). The verdict is
// persisted on the draft and gates publishing.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { id } = await params;
  try {
    const result = await validateDraftTemplate(id);
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (err: any) {
    console.error("[Style Lab Draft Validate POST] Error:", err);
    const msg = err?.message ?? "Draft validation failed";
    const status = /not found/.test(msg) ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
