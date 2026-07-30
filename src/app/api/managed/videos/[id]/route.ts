export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";

// PATCH /api/managed/videos/[id] — update status (mark as downloaded, clipped, skipped)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "accounts"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const updates: Record<string, unknown> = {};

  if (body.status) updates.status = body.status;
  if (body.downloadUrl) updates.downloadUrl = body.downloadUrl;

  const video = await prisma.youTubeSourcedVideo.update({
    where: { id },
    data: updates,
  });

  return NextResponse.json(video);
}

// DELETE /api/managed/videos/[id] — remove a sourced video
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "accounts"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  await prisma.youTubeSourcedVideo.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
