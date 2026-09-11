export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getAdminNotifications } from "@/lib/services/notifications";

// GET /api/admin/notifications — latest notifications + unread count for the
// admin top-bar bell. Any signed-in staff member can read operational alerts.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await getAdminNotifications());
}
