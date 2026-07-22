export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { markScheduled } from "@/lib/services/distribution";

// POST /api/distribution/mark-scheduled { deliveryIds: string[] }
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "accounts"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const deliveryIds = body?.deliveryIds;
  if (!Array.isArray(deliveryIds) || deliveryIds.length === 0 || !deliveryIds.every((id: any) => typeof id === "string")) {
    return NextResponse.json({ error: "deliveryIds must be a non-empty string array" }, { status: 400 });
  }

  try {
    const result = await markScheduled(deliveryIds, session.userId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error("[Distribution Mark Scheduled API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to mark scheduled" }, { status: 500 });
  }
}
