export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";

// GET /api/sourcing/niches/[id] — get a single niche with accounts and sources
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "sourcing"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const niche = await prisma.sourcingNiche.findUnique({
    where: { id },
    include: {
      accounts: {
        include: {
          account: {
            select: {
              id: true,
              tiktokUsername: true,
              tiktokDisplayName: true,
              tiktokAvatarUrl: true,
              isActive: true,
              group: { select: { name: true, section: { select: { name: true } } } },
            },
          },
        },
      },
      sources: {
        include: { _count: { select: { videos: true } } },
        orderBy: { createdAt: "desc" },
      },
      _count: { select: { videos: true } },
    },
  });

  if (!niche) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(niche);
}

// PATCH /api/sourcing/niches/[id] — update name/description/color
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "sourcing"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const updates: Record<string, unknown> = {};
  if (body.name) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.color) updates.color = body.color;

  const niche = await prisma.sourcingNiche.update({ where: { id }, data: updates });
  return NextResponse.json(niche);
}

// DELETE /api/sourcing/niches/[id] — delete a niche (cascades to sources + videos)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "sourcing"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  await prisma.sourcingNiche.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
