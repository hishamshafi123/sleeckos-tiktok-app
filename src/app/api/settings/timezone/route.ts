import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getOrgTimezone, setOrgTimezone } from "@/lib/services/timezone";
import { can } from "@/lib/services/permissions";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const tz = await getOrgTimezone();
    const canEdit = await can(session.userId, "users_access");
    return NextResponse.json({ timezone: tz, canEdit });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load timezone" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isAllowed = await can(session.userId, "users_access");
  if (!isAllowed) {
    return NextResponse.json({ error: "Forbidden: Admin access required" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { timezone } = body;
    if (!timezone) {
      return NextResponse.json({ error: "Missing timezone parameter" }, { status: 400 });
    }

    await setOrgTimezone(timezone);
    return NextResponse.json({ success: true, timezone });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to save timezone" }, { status: 500 });
  }
}
