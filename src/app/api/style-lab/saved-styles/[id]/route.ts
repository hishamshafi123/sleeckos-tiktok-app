export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import {
  deleteSavedStyle,
  generateSavedStyleThumbnail,
  updateSavedStyle,
} from "@/lib/services/style-lab";

// PATCH /api/style-lab/saved-styles/[id]
// Body: { name?, params?, layers?, tags? } — layers: StyleLayer[] to set the
// stack, null to revert to a legacy single-layer style. params/layers
// changes re-render the thumbnail in the background.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "style_studio"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const body = await req.json();
    const { name, params: styleParams, layers, tags } = body;

    const updated = await updateSavedStyle(id, {
      ...(name !== undefined ? { name } : {}),
      ...(styleParams !== undefined ? { params: styleParams } : {}),
      ...(layers !== undefined ? { layers } : {}),
      ...(tags !== undefined ? { tags } : {}),
    });

    if (styleParams !== undefined || layers !== undefined) {
      void generateSavedStyleThumbnail(id).catch(() => undefined);
    }

    return NextResponse.json(updated);
  } catch (err: any) {
    console.error("[Style Lab Saved Style PATCH] Error:", err);
    const msg = err?.message ?? "";
    const status = msg.includes("not found") ? 404 : /Unknown param|Unknown Style Lab template/.test(msg) ? 400 : 500;
    return NextResponse.json({ error: msg || "Failed to update style" }, { status });
  }
}

// DELETE /api/style-lab/saved-styles/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "style_studio"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    await deleteSavedStyle(id);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[Style Lab Saved Style DELETE] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to delete style" }, { status: 500 });
  }
}
