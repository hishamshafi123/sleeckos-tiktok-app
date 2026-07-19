import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { generateHooks } from "@/lib/services/multiplier";
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
    const { count = 5, useCampaignContext = true, customPrompt } = await req.json();

    const group = await prisma.multiplierGroup.findUnique({
      where: { id: groupId },
    });

    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    if (!group.transcript) {
      return NextResponse.json({ error: "No transcript found. Please transcribe the video first." }, { status: 400 });
    }

    const hooks = await generateHooks(groupId, count, useCampaignContext, customPrompt);
    return NextResponse.json({ success: true, hooks });
  } catch (err: any) {
    console.error("[Multiplier AI Hooks POST API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to generate hooks via AI" }, { status: 500 });
  }
}
