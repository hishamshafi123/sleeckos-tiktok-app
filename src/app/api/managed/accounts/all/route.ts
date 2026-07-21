export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";

// GET /api/managed/accounts/all — list all managed accounts for the account picker
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "accounts"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const accounts = await prisma.managedAccount.findMany({
    orderBy: { tiktokUsername: "asc" },
    select: {
      id: true,
      tiktokUsername: true,
      tiktokDisplayName: true,
      tiktokAvatarUrl: true,
      isActive: true,
      driveFolderId: true,
      driveFolderName: true,
      color: true,
      colorId: true,
      colorRef: true,
      section: {
        select: {
          name: true,
          slug: true,
        },
      },
    },
  });

  return NextResponse.json(accounts);
}
