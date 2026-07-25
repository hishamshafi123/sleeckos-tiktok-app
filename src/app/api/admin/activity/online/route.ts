export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getOnlineUsers } from "@/lib/services/activity";

const ONLINE_WINDOW_MINUTES = 5;

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await getOnlineUsers({ onlineWindowMinutes: ONLINE_WINDOW_MINUTES });
  return NextResponse.json({ users, thresholdMinutes: ONLINE_WINDOW_MINUTES });
}
