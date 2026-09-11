export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { markAllNotificationsRead } from "@/lib/services/notifications";

// POST /api/admin/notifications/read — mark every notification read (global).
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await markAllNotificationsRead());
}
