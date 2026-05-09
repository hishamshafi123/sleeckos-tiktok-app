export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";

// GET /api/managed/groups/[id] — get group with accounts
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const group = await prisma.accountGroup.findUnique({
    where: { id },
    include: {
      section: true,
      accounts: {
        orderBy: { createdAt: "desc" },
        include: {
          _count: { select: { scheduledPosts: true } },
        },
      },
    },
  });

  if (!group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  return NextResponse.json(group);
}

// PATCH /api/managed/groups/[id] — update group
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
  if (body.description !== undefined) data.description = body.description;
  if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;

  const group = await prisma.accountGroup.update({
    where: { id },
    data,
  });

  return NextResponse.json(group);
}

// DELETE /api/managed/groups/[id] — delete group (cascades accounts)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  await prisma.accountGroup.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
