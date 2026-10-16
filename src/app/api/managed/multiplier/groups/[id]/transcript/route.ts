export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";

// GET /api/managed/multiplier/groups/[id]/transcript — Lazy-load a single
// group's transcript (large word-level JSON excluded from the list payload).
export async function GET(
  _req: NextRequest,
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
    const group = await prisma.multiplierGroup.findUnique({
      where: { id: groupId },
      select: { id: true, transcript: true },
    });
    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    return NextResponse.json(group, { headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    console.error("[Multiplier Group Transcript GET API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to fetch transcript" }, { status: 500 });
  }
}
