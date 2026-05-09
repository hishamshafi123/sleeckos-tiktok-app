export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";

// GET /api/managed/groups/by-path/[sectionSlug]/[groupSlug]
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sectionSlug: string; groupSlug: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sectionSlug, groupSlug } = await params;

  const section = await prisma.accountSection.findUnique({
    where: { slug: sectionSlug },
  });
  if (!section) {
    return NextResponse.json({ error: "Section not found" }, { status: 404 });
  }

  const group = await prisma.accountGroup.findUnique({
    where: { sectionId_slug: { sectionId: section.id, slug: groupSlug } },
    include: {
      section: true,
      accounts: {
        orderBy: { createdAt: "desc" },
        include: {
          _count: {
            select: {
              scheduledPosts: {
                where: { status: "PUBLISHED" },
              },
            },
          },
        },
      },
    },
  });

  if (!group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  return NextResponse.json(group);
}
