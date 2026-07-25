export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getLoginEvents } from "@/lib/services/activity";

const MAX_LIMIT = 200;

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = new URL(req.url).searchParams;
  const userId = params.get("userId") || undefined;
  const limitParam = parseInt(params.get("limit") || "", 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(limitParam, MAX_LIMIT)
    : 50;

  const events = await getLoginEvents({ userId, limit });
  return NextResponse.json({ events });
}
