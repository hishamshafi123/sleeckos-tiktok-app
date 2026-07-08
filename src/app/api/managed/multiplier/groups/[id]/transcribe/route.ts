import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { transcribeGroup } from "@/lib/services/multiplier";
import prisma from "@/lib/db";

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

    // Trigger transcription. Since Whisper alignment can take some time,
    // we trigger it in the background to prevent serverless timeout.
    transcribeGroup(groupId).catch((err) => {
      console.error(`[Multiplier Background Transcribe] Error on Group ${groupId}:`, err);
    });

    return NextResponse.json({ success: true, message: "Transcription started in background" });
  } catch (err: any) {
    console.error("[Multiplier Transcribe POST API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to trigger transcription" }, { status: 500 });
  }
}
