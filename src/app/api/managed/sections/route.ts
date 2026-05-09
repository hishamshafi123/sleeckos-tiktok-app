export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";

// GET /api/managed/sections — list all sections with counts
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sections = await prisma.accountSection.findMany({
    orderBy: { sortOrder: "asc" },
    include: {
      groups: {
        orderBy: { sortOrder: "asc" },
        include: {
          _count: { select: { accounts: true } },
        },
      },
    },
  });

  // Enrich with aggregate counts
  const enriched = sections.map((s) => ({
    ...s,
    totalGroups: s.groups.length,
    totalAccounts: s.groups.reduce((sum, g) => sum + g._count.accounts, 0),
  }));

  return NextResponse.json(enriched);
}

// POST /api/managed/sections — create new section
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name, color, icon } = await req.json();
  if (!name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  const maxOrder = await prisma.accountSection.aggregate({
    _max: { sortOrder: true },
  });

  const section = await prisma.accountSection.create({
    data: {
      name: name.trim(),
      slug,
      color: color || "#8b5cf6",
      icon: icon || null,
      sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
    },
  });

  return NextResponse.json(section, { status: 201 });
}
