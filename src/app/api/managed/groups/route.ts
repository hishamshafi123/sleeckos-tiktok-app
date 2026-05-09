export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";

// POST /api/managed/groups — create a group in a section
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sectionId, name, description } = await req.json();
  if (!sectionId || !name?.trim()) {
    return NextResponse.json(
      { error: "sectionId and name are required" },
      { status: 400 }
    );
  }

  // Verify section exists
  const section = await prisma.accountSection.findUnique({
    where: { id: sectionId },
  });
  if (!section) {
    return NextResponse.json({ error: "Section not found" }, { status: 404 });
  }

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  const maxOrder = await prisma.accountGroup.aggregate({
    where: { sectionId },
    _max: { sortOrder: true },
  });

  const group = await prisma.accountGroup.create({
    data: {
      sectionId,
      name: name.trim(),
      slug,
      description: description?.trim() || null,
      sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
    },
  });

  return NextResponse.json(group, { status: 201 });
}
