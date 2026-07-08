import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const campaigns = await prisma.campaign.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        type: true,
        description: true,
        brief: true,
      },
    });

    return NextResponse.json(campaigns);
  } catch (err: any) {
    console.error("[Campaigns List GET API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to list campaigns" }, { status: 500 });
  }
}
