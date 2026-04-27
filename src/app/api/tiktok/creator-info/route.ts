import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { getSession } from "@/lib/session";
import { getCreatorInfo } from "@/lib/tiktok";

const prisma = new PrismaClient();

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await prisma.tiktokAccount.findFirst({
    where: { userId: session.userId, revokedAt: null }
  });

  if (!account) return NextResponse.json({ error: "No connected account" }, { status: 400 });

  try {
    const data = await getCreatorInfo(account.accessToken);
    if (data.error && data.error.code !== "ok") {
      return NextResponse.json({ error: data.error.message || "Failed to fetch creator info" }, { status: 400 });
    }
    return NextResponse.json(data.data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
