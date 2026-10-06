export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { markAllUserNotificationsRead } from "@/lib/services/notifications";

// POST /api/notifications/read — mark every notification read for the
// signed-in user.
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await markAllUserNotificationsRead(session.userId));
}
