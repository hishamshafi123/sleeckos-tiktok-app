export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { status, reason } = await req.json();

  if (!["APPROVED", "REJECTED", "SUSPENDED"].includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  try {
    const brand = await prisma.brand.findUnique({ where: { id } });
    if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

    // Update brand status
    const updatedBrand = await prisma.brand.update({
      where: { id },
      data: {
        status,
        approvedAt: status === "APPROVED" ? new Date() : null,
        approvedById: status === "APPROVED" ? session.userId : null,
        rejectionReason: reason || null,
      },
    });

    // Also update the owner's user status if applicable
    await prisma.user.update({
      where: { id: brand.ownerUserId },
      data: {
        status: status === "APPROVED" ? "APPROVED" : status === "REJECTED" ? "PENDING" : "SUSPENDED"
      }
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: session.userId,
        action: `BRAND_${status}`,
        resourceType: "Brand",
        resourceId: id,
        metadata: { reason }
      }
    });

    return NextResponse.json(updatedBrand);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
