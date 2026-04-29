export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "BRAND_OWNER") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const brand = await prisma.brand.findUnique({ where: { ownerUserId: session.userId } });
    if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

    const deliverable = await prisma.deliverable.findUnique({
      where: { id },
      include: { campaign: true }
    });

    if (!deliverable || deliverable.campaign.brandId !== brand.id) {
      return NextResponse.json({ error: "Deliverable not found or unauthorized" }, { status: 404 });
    }

    const updated = await prisma.deliverable.update({
      where: { id },
      data: { status: "DRAFT_APPROVED", updatedAt: new Date() },
    });

    return NextResponse.json(updated);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
