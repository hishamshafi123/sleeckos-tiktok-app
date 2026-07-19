export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { naturalCompare } from "@/lib/utils/sorting";

// GET /api/managed/sections/by-slug/[slug] — find section by slug with groups
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "accounts"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { slug } = await params;
  const section = await prisma.accountSection.findUnique({
    where: { slug },
    include: {
      groups: {
        orderBy: { sortOrder: "asc" },
        include: {
          accounts: {
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              tiktokUsername: true,
              tiktokDisplayName: true,
              tiktokAvatarUrl: true,
              followerCount: true,
              isActive: true,
              driveConnected: true,
              driveFolderId: true,
              driveFolderName: true,
              postTimeHour: true,
              postTimeMinute: true,
              postTimezone: true,
              tokenExpiresAt: true,
            },
          },
          _count: { select: { accounts: true } },
        },
      },
    },
  });

  if (!section) {
    return NextResponse.json({ error: "Section not found" }, { status: 404 });
  }

  // Sort each group's accounts list naturally by driveFolderName
  const sectionObj = JSON.parse(JSON.stringify(section));
  for (const group of sectionObj.groups || []) {
    if (group.accounts && Array.isArray(group.accounts)) {
      group.accounts.sort((a: any, b: any) => {
        const nameA = a.driveFolderName || "";
        const nameB = b.driveFolderName || "";
        return naturalCompare(nameA, nameB);
      });
    }
  }

  return NextResponse.json(sectionObj);
}
