export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { searchAccounts } from "@/lib/services/multiplier-export";

// GET /api/accounts/search?q=&mode=drive|account
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const q = req.nextUrl.searchParams.get("q") || "";
  const mode = req.nextUrl.searchParams.get("mode") || "drive";

  if (mode !== "drive" && mode !== "account") {
    return NextResponse.json({ error: "Invalid mode. Expected drive | account" }, { status: 400 });
  }

  try {
    const results = await searchAccounts({ q, mode });
    return NextResponse.json({ results });
  } catch (err: any) {
    console.error("[Accounts Search API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to search accounts" }, { status: 500 });
  }
}
