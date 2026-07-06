import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import prisma from "@/lib/db";
import { can } from "@/lib/services/permissions";

export const dynamic = "force-dynamic";

// GET: fetch vault audit logs
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Ensure projects entitlement exists
  const hasProjects = await can(session.userId, "projects");
  if (!hasProjects) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const logs = await prisma.vaultAuditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 200, // retrieve the latest 200 events
    });

    return NextResponse.json(logs);
  } catch (err: any) {
    console.error("[Vault Audit Logs GET] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to fetch audit logs" }, { status: 500 });
  }
}
