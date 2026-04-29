export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "BRAND_OWNER") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { status } = await req.json();

  try {
    const brand = await prisma.brand.findUnique({ where: { ownerUserId: session.userId } });
    if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

    const application = await prisma.application.findUnique({
      where: { id },
      include: { campaign: true }
    });

    if (!application || application.campaign.brandId !== brand.id) {
      return NextResponse.json({ error: "Application not found or unauthorized" }, { status: 404 });
    }

    const updatedApplication = await prisma.application.update({
      where: { id },
      data: { status, decisionAt: new Date(), decidedById: session.userId },
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

    return NextResponse.json(updatedApplication);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
