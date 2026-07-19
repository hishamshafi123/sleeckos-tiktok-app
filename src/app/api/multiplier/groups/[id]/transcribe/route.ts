import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { transcribeGroup } from "@/lib/services/multiplier";
import prisma from "@/lib/db";

// POST /api/multiplier/groups/[id]/transcribe — start background transcription
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
    const group = await prisma.multiplierGroup.findUnique({
      where: { id: groupId },
    });
    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    // Trigger transcription in the background (Whisper alignment can take a while)
    transcribeGroup(groupId).catch((err) => {
      console.error(`[Multiplier Background Transcribe] Error on Group ${groupId}:`, err);
    });

    return NextResponse.json({ status: "TRANSCRIBING" });
  } catch (err: any) {
    console.error("[Multiplier Transcribe POST API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to trigger transcription" }, { status: 500 });
  }
}
