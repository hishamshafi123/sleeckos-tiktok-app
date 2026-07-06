import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import prisma from "@/lib/db";
import { can } from "@/lib/services/permissions";

export const dynamic = "force-dynamic";

// GET: list all active users and roles
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Double check basic projects entitlement to prevent random user access
  const hasProjects = await can(session.userId, "projects");
  if (!hasProjects) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const users = await prisma.user.findMany({
      where: { status: { not: "DISABLED" } },
      select: {
        id: true,
        name: true,
        email: true,
        role: {
          select: {
            id: true,
            key: true,
            label: true,
          },
        },
      },
      orderBy: { name: "asc" },
    });

    const roles = await prisma.role.findMany({
      select: {
        id: true,
        key: true,
        label: true,
      },
      orderBy: { label: "asc" },
    });

    return NextResponse.json({ users, roles });
  } catch (err: any) {
    console.error("[Vault Users GET] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to fetch users" }, { status: 500 });
  }
}
