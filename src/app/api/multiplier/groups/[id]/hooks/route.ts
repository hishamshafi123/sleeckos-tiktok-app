import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { addManualHook, updateHook, regenerateHook } from "@/lib/services/multiplier";
import prisma from "@/lib/db";

// PATCH /api/multiplier/groups/[id]/hooks
// Body: { action: "add" | "update" | "delete" | "regenerate", hookId?, text?, count? }
export async function PATCH(
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
    const body = await req.json();
    const { action, hookId, text } = body;

    const group = await prisma.multiplierGroup.findUnique({
      where: { id: groupId },
    });
    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    switch (action) {
      case "add": {
        if (!text || !String(text).trim()) {
          return NextResponse.json({ error: "Missing hook text" }, { status: 400 });
        }
        const hook = await addManualHook(groupId, String(text));
        return NextResponse.json({ hook });
      }

      case "update": {
        if (!hookId) {
          return NextResponse.json({ error: "Missing hookId" }, { status: 400 });
        }
        if (!text || !String(text).trim()) {
          return NextResponse.json({ error: "Missing hook text" }, { status: 400 });
        }
        const hook = await updateHook(hookId, String(text));
        return NextResponse.json({ hook });
      }

      case "delete": {
        if (!hookId) {
          return NextResponse.json({ error: "Missing hookId" }, { status: 400 });
        }
        await prisma.multiplierHook.delete({ where: { id: hookId } });
        return NextResponse.json({ success: true });
      }

      case "regenerate": {
        if (!hookId) {
          return NextResponse.json({ error: "Missing hookId" }, { status: 400 });
        }
        if (!group.transcript) {
          return NextResponse.json({ error: "No transcript found. Please transcribe the video first." }, { status: 400 });
        }
        const hook = await regenerateHook(hookId);
        return NextResponse.json({ hook });
      }

      default:
        return NextResponse.json({ error: "Invalid action. Expected add | update | delete | regenerate" }, { status: 400 });
    }
  } catch (err: any) {
    console.error("[Multiplier Hooks PATCH API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to modify hooks" }, { status: 500 });
  }
}
