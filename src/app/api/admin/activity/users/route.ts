export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getUserActivity, type PresenceStatus } from "@/lib/services/activity";

const VALID_STATUSES: PresenceStatus[] = ["online", "idle", "offline"];

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = new URL(req.url).searchParams;
  const role = params.get("role") || undefined;
  const statusParam = params.get("status") || undefined;
  const status = VALID_STATUSES.includes(statusParam as PresenceStatus)
    ? (statusParam as PresenceStatus)
    : undefined;

  const users = await getUserActivity({ role, status });
  return NextResponse.json({ users });
}
