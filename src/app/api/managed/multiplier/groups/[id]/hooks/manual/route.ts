import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { addManualHook, updateHook } from "@/lib/services/multiplier";
import prisma from "@/lib/db";

// POST /api/managed/multiplier/groups/[id]/hooks/manual — Add a new manual hook
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: groupId } = await params;

  try {
    const { text } = await req.json();
    if (!text) {
      return NextResponse.json({ error: "Missing hook text" }, { status: 400 });
    }

    const hook = await addManualHook(groupId, text);
    return NextResponse.json(hook);
  } catch (err: any) {
    console.error("[Multiplier Manual Hook POST] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to add manual hook" }, { status: 500 });
  }
}

// PUT /api/managed/multiplier/groups/[id]/hooks/manual — Edit an existing hook
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { hookId, text } = await req.json();
    if (!hookId || !text) {
      return NextResponse.json({ error: "Missing hookId or text" }, { status: 400 });
    }

    const hook = await updateHook(hookId, text);
    return NextResponse.json(hook);
  } catch (err: any) {
    console.error("[Multiplier Manual Hook PUT] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to update hook" }, { status: 500 });
  }
}

// DELETE /api/managed/multiplier/groups/[id]/hooks/manual — Delete a hook
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const hookId = searchParams.get("hookId");

  if (!hookId) {
    return NextResponse.json({ error: "Missing hookId" }, { status: 400 });
  }

  try {
    await prisma.multiplierHook.delete({
      where: { id: hookId },
    });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[Multiplier Manual Hook DELETE] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to delete hook" }, { status: 500 });
  }
}
