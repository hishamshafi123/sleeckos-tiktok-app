export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";

// GET /api/managed/accounts/all — list all managed accounts for the account picker
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accounts = await prisma.managedAccount.findMany({
    orderBy: { tiktokUsername: "asc" },
    select: {
      id: true,
      tiktokUsername: true,
      tiktokDisplayName: true,
      tiktokAvatarUrl: true,
      isActive: true,
      group: {
        select: {
          name: true,
          section: { select: { name: true } },
        },
      },
    },
  });

  return NextResponse.json(accounts);
}
