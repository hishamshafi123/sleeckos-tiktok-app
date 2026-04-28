export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { videoUrl, caption } = await req.json();

  if (!videoUrl || !caption) {
    return NextResponse.json({ error: "Missing videoUrl or caption" }, { status: 400 });
  }

  try {
    const deliverable = await prisma.deliverable.findUnique({
      where: { id },
    });

    if (!deliverable || deliverable.creatorUserId !== session.userId) {
      return NextResponse.json({ error: "Deliverable not found or unauthorized" }, { status: 404 });
    }

    const updated = await prisma.deliverable.update({
      where: { id },
      data: {
        draftVideoUrl: videoUrl,
        draftCaption: caption,
        status: "DRAFT_UPLOADED",
        updatedAt: new Date(),
      },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: session.userId,
        action: "DELIVERABLE_SUBMITTED",
        resourceType: "Deliverable",
        resourceId: id,
      },
    });

    return NextResponse.json(updated);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
