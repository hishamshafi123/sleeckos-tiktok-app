export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getUserNotifications } from "@/lib/services/notifications";

// GET /api/notifications — latest notifications + unread count for the
// signed-in user's bell.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await getUserNotifications(session.userId));
}
