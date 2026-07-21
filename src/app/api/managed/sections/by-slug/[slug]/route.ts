export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { naturalCompare } from "@/lib/utils/sorting";

// GET /api/managed/sections/by-slug/[slug] — find section by slug with its accounts
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

  if (!section) {
    return NextResponse.json({ error: "Section not found" }, { status: 404 });
  }

  // Sanitizing sensitive tokens from the API payload
  const sanitizedAccounts = (section as any).accounts.map((acc: any) => {
    const { googleAccessToken, googleRefreshToken, ...rest } = acc as any;
    return {
      ...rest,
      googleOAuthConnected: !!googleRefreshToken,
    };
  });

  // Sort naturally by driveFolderName using naturalCompare
  sanitizedAccounts.sort((a: any, b: any) => {
    const nameA = a.driveFolderName || "";
    const nameB = b.driveFolderName || "";
    return naturalCompare(nameA, nameB);
  });

  return NextResponse.json({
    ...section,
    accounts: sanitizedAccounts,
  });
}
