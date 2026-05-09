export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";

// PATCH /api/managed/sections/[id] — update section
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const data: Record<string, unknown> = {};

  if (body.name !== undefined) {
    data.name = body.name.trim();
    data.slug = body.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }
  if (body.color !== undefined) data.color = body.color;
  if (body.icon !== undefined) data.icon = body.icon;
  if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;

  const section = await prisma.accountSection.update({
    where: { id },
    data,
  });

  return NextResponse.json(section);
}

// DELETE /api/managed/sections/[id] — delete section (cascades groups + accounts)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  await prisma.accountSection.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
