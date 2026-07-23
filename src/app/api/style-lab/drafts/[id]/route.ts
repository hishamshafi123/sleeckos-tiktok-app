export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { deleteDraftTemplate, updateDraftTemplate } from "@/lib/services/style-lab";

// PATCH /api/style-lab/drafts/[id] — ADMIN ONLY.
// Body: { name?, tags?, defaultParams?, layers? } — edits made in the editor.
// Any param/layer edit invalidates the previous validation (re-validate
// before publish).
export async function PATCH(
  req: NextRequest,
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
    const body = await req.json();
    const { name, tags, defaultParams, layers } = body;
    const updated = await updateDraftTemplate(id, {
      ...(name !== undefined ? { name } : {}),
      ...(tags !== undefined && Array.isArray(tags) ? { tags } : {}),
      ...(defaultParams !== undefined ? { defaultParams } : {}),
      ...(layers !== undefined ? { layers } : {}),
    });
    return NextResponse.json(updated);
  } catch (err: any) {
    console.error("[Style Lab Draft PATCH] Error:", err);
    const msg = err?.message ?? "Failed to update draft";
    const status = /not found/.test(msg) ? 404 : /Unknown param|cannot be empty|Only draft/.test(msg) ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

// DELETE /api/style-lab/drafts/[id] — ADMIN ONLY. Drafts only; published
// templates stay in the library.
export async function DELETE(
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
    await deleteDraftTemplate(id);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[Style Lab Draft DELETE] Error:", err);
    const msg = err?.message ?? "Failed to delete draft";
    const status = /not found/.test(msg) ? 404 : /Only draft/.test(msg) ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
