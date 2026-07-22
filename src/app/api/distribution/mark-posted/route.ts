export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { markPosted } from "@/lib/services/distribution";

// POST /api/distribution/mark-posted { deliveryIds, postedCount?, postedAt?, note? }
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

  const options: { postedCount?: number; postedAt?: Date; note?: string } = {};
  if (body.postedCount !== undefined && body.postedCount !== null) {
    const n = Number(body.postedCount);
    if (!Number.isInteger(n) || n < 0) {
      return NextResponse.json({ error: "postedCount must be a non-negative integer" }, { status: 400 });
    }
    options.postedCount = n;
  }
  if (body.postedAt) {
    const d = new Date(body.postedAt);
    if (isNaN(d.getTime())) {
      return NextResponse.json({ error: "Invalid postedAt date" }, { status: 400 });
    }
    options.postedAt = d;
  }
  if (typeof body.note === "string" && body.note.trim()) {
    options.note = body.note.trim();
  }

  try {
    const result = await markPosted(deliveryIds, session.userId, options);
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error("[Distribution Mark Posted API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to mark posted" }, { status: 500 });
  }
}
