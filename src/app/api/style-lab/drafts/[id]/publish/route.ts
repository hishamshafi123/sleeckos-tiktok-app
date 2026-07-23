export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { publishDraftTemplate } from "@/lib/services/style-lab";

// POST /api/style-lab/drafts/[id]/publish — ADMIN ONLY.
// Requires a recent (<= 1h) all-green validation; flips status to
// "published" so the template joins the main gallery and saved-style
// creation (forks are stored as layered-style saved styles).
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
    const published = await publishDraftTemplate(id);
    return NextResponse.json(published);
  } catch (err: any) {
    console.error("[Style Lab Draft Publish POST] Error:", err);
    const msg = err?.message ?? "Failed to publish draft";
    const status = /not found/.test(msg) ? 404 : /must pass validation/.test(msg) ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
