export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import {
  listAccountColors,
  createAccountColor,
  updateAccountColor,
  deleteAccountColor,
  getGlobalFallbackPostCount,
  setGlobalFallbackPostCount,
} from "@/lib/services/accounts";

// GET /api/managed/accounts/colors
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "accounts"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const colors = await listAccountColors();
    const fallbackCount = await getGlobalFallbackPostCount();
    return NextResponse.json({ colors, defaultPostCountFallback: fallbackCount });
  } catch (err: any) {
    console.error("[Account Colors GET] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to load colors" }, { status: 500 });
  }
}

// POST /api/managed/accounts/colors
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "accounts"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { color, meaning, defaultPostCount, order } = body;
    if (!color?.trim() || !meaning?.trim() || defaultPostCount === undefined) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const count = parseInt(defaultPostCount, 10);
    if (isNaN(count) || count < 0) {
      return NextResponse.json({ error: "Default post count must be a non-negative integer" }, { status: 400 });
    }

    const created = await createAccountColor({
      color: color.trim(),
      meaning: meaning.trim(),
      defaultPostCount: count,
      order: order !== undefined ? parseInt(order, 10) : 0,
    });

    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    console.error("[Account Colors POST] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to create color" }, { status: 500 });
  }
}

// PATCH /api/managed/accounts/colors
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "accounts"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { id, color, meaning, defaultPostCount, order, defaultPostCountFallback } = body;

    // Handle global setting update
    if (defaultPostCountFallback !== undefined) {
      const fallback = parseInt(defaultPostCountFallback, 10);
      if (isNaN(fallback) || fallback < 0) {
        return NextResponse.json({ error: "Fallback count must be a non-negative integer" }, { status: 400 });
      }
      await setGlobalFallbackPostCount(fallback);
      return NextResponse.json({ success: true, defaultPostCountFallback: fallback });
    }

    if (!id) {
      return NextResponse.json({ error: "Missing color ID" }, { status: 400 });
    }

    const data: any = {};
    if (color !== undefined) data.color = color.trim();
    if (meaning !== undefined) data.meaning = meaning.trim();
    if (defaultPostCount !== undefined) {
      const count = parseInt(defaultPostCount, 10);
      if (isNaN(count) || count < 0) {
        return NextResponse.json({ error: "Default post count must be a non-negative integer" }, { status: 400 });
      }
      data.defaultPostCount = count;
    }
    if (order !== undefined) data.order = parseInt(order, 10);

    const updated = await updateAccountColor(id, data);
    return NextResponse.json(updated);
  } catch (err: any) {
    console.error("[Account Colors PATCH] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to update color" }, { status: 500 });
  }
}

// DELETE /api/managed/accounts/colors
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "accounts"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const reassignToId = searchParams.get("reassignToId");

  if (!id) {
    return NextResponse.json({ error: "Missing color ID" }, { status: 400 });
  }

  try {
    const deleted = await deleteAccountColor(id, reassignToId);
    return NextResponse.json({ success: true, deleted });
  } catch (err: any) {
    console.error("[Account Colors DELETE] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to delete color" }, { status: 400 });
  }
}
