export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";

// GET /api/sourcing/niches — list all sourcing niches with counts
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const niches = await prisma.sourcingNiche.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { sources: true, videos: true, accounts: true } },
    },
  });

  return NextResponse.json(niches);
}

// POST /api/sourcing/niches — create a new sourcing niche
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name, description, color } = await req.json();
  if (!name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  try {
    const niche = await prisma.sourcingNiche.create({
      data: {
        name: name.trim(),
        slug,
        description: description?.trim() || null,
        color: color || "#ef4444",
      },
    });
    return NextResponse.json(niche, { status: 201 });
  } catch {
    return NextResponse.json({ error: "A niche with this name already exists" }, { status: 409 });
  }
}
