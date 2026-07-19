export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";

// GET /api/managed/groups/by-path/[sectionSlug]/[groupSlug]
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sectionSlug: string; groupSlug: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "accounts"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
          colorRef: true,
          _count: {
            select: {
              scheduledPosts: {
                where: { status: { in: ["PUBLISHED", "PENDING_DELETION", "DELETED"] } },
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

  // Sanitizing sensitive tokens from the API payload
  const sanitizedAccounts = (group as any).accounts.map((acc: any) => {
    const { googleAccessToken, googleRefreshToken, ...rest } = acc as any;
    return {
      ...rest,
      googleOAuthConnected: !!googleRefreshToken,
    };
  });

  // Sort naturally by driveFolderName
  sanitizedAccounts.sort((a: any, b: any) => {
    const nameA = a.driveFolderName || "";
    const nameB = b.driveFolderName || "";
    return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
  });

  return NextResponse.json({
    ...group,
    accounts: sanitizedAccounts,
  });
}
