export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { status } = await req.json();

  try {
    const application = await prisma.application.update({
      where: { id },
      data: { status, decisionAt: new Date(), decidedById: session.userId },
      include: { campaign: true }
    });

    // If accepted, create the initial deliverable record
    if (status === "ACCEPTED") {
      await prisma.deliverable.create({
        data: {
          applicationId: application.id,
          campaignId: application.campaignId,
          creatorUserId: application.creatorUserId,
          status: "BRIEFED",
        }
      });
    }

    return NextResponse.json(application);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
