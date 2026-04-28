export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: campaignId } = await params;
  const { pitch } = await req.json();

  if (!pitch) return NextResponse.json({ error: "Pitch is required" }, { status: 400 });

  try {
    // Check if campaign exists
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    
    // For demo purposes, we'll allow applying to d1/d2 by creating a campaign in the DB first if it doesn't exist
    // In a real app, these campaigns would already be there.
    if (!campaign && campaignId.startsWith("d")) {
      // Just a safety check to ensure we can test the flow
      return NextResponse.json({ error: "Campaign d1/d2 is for display only in this demo. Please use the 'Post Campaign' flow as a Brand first." }, { status: 400 });
    }

    const application = await prisma.application.create({
      data: {
        campaignId,
        creatorUserId: session.userId,
        pitch,
        status: "SUBMITTED",
      },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: session.userId,
        action: "CAMPAIGN_APPLIED",
        resourceType: "Application",
        resourceId: application.id,
      },
    });

    return NextResponse.json(application);
  } catch (err: any) {
    if (err.code === "P2002") {
      return NextResponse.json({ error: "You have already applied to this campaign." }, { status: 400 });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
