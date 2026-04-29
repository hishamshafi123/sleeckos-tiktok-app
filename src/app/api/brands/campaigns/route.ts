export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "BRAND_OWNER") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const data = await req.json();

  try {
    const brand = await prisma.brand.findUnique({
      where: { ownerUserId: session.userId }
    });

    if (!brand) return NextResponse.json({ error: "Brand profile not found" }, { status: 404 });
    if (brand.status !== "APPROVED") return NextResponse.json({ error: "Brand is not approved to post campaigns yet" }, { status: 403 });

    const campaign = await prisma.campaign.create({
      data: {
        brandId: brand.id,
        slug: data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now(),
        title: data.title,
        description: data.description,
        brief: data.brief,
        payoutPerPostCents: data.payoutPerPostCents,
        totalBudgetCents: data.payoutPerPostCents * data.maxCreators,
        maxCreators: data.maxCreators,
        applicationDeadline: new Date(data.applicationDeadline),
        deliveryDeadline: new Date(new Date(data.applicationDeadline).getTime() + 14 * 24 * 60 * 60 * 1000),
        requiredHashtags: data.requiredHashtags || [],
        requiredMentions: data.requiredMentions || [],
        status: "OPEN",
      }
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: session.userId,
        action: "CAMPAIGN_CREATED",
        resourceType: "Campaign",
        resourceId: campaign.id,
      }
    });

    return NextResponse.json(campaign);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
