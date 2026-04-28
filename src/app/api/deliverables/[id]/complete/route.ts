export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { tiktokVideoId } = await req.json();

  try {
    const updated = await prisma.deliverable.update({
      where: { id },
      data: {
        status: "PUBLISHED",
        tiktokVideoId,
        publishedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: session.userId,
        action: "DELIVERABLE_PUBLISHED",
        resourceType: "Deliverable",
        resourceId: id,
        metadata: { tiktokVideoId },
      },
    });

    return NextResponse.json(updated);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
