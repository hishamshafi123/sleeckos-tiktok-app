export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { getSavedStyles, createSavedStyle, updateSavedStyle, deleteSavedStyle } from "@/lib/services/style-studio";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "style_studio"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const styles = await getSavedStyles();
    return NextResponse.json(styles);
  } catch (err: any) {
    console.error("[Saved Styles GET] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to load saved styles" }, { status: 500 });
  }
}

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
    const { templateKey, name, params, thumbnail, tags } = body;
    if (!templateKey || !name || !params) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const style = await createSavedStyle({
      templateKey,
      name,
      params,
      thumbnail,
      tags,
      createdBy: session.userId,
    });
    return NextResponse.json(style, { status: 201 });
  } catch (err: any) {
    console.error("[Saved Styles POST] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to save style preset" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "style_studio"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { id, name, params, thumbnail, tags } = body;
    if (!id) {
      return NextResponse.json({ error: "Missing style ID" }, { status: 400 });
    }

    const updated = await updateSavedStyle(id, {
      name,
      params,
      thumbnail,
      tags,
    });
    return NextResponse.json(updated);
  } catch (err: any) {
    console.error("[Saved Styles PATCH] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to update style preset" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "style_studio"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing style ID" }, { status: 400 });
  }

  try {
    await deleteSavedStyle(id);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[Saved Styles DELETE] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to delete style preset" }, { status: 500 });
  }
}
