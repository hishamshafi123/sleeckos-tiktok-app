export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";

// GET /api/managed/multiplier/google/auth — Redirect to manage page for Drive connection
// The multiplier reuses the Drive connection from ManagedAccount, so we redirect
// the user to the manage page where they can connect Drive for their account.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const appUrl = process.env.APP_URL || "https://sleeckos.com";

  // Redirect to manage page with a note to connect Google Drive there
  return NextResponse.redirect(`${appUrl}/admin/accounts?connect_drive=true`);
}
