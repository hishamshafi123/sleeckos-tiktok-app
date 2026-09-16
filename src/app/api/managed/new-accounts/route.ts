export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { getNewAccountsOverview } from "@/lib/services/new-accounts";

/**
 * GET /api/managed/new-accounts?sectionId=&addedFrom=YYYY-MM-DD&addedTo=YYYY-MM-DD&search=&neverPosted=1
 *
 * Accounts sorted newest → oldest by date added, grouped into weekly cohorts,
 * with server-side post-count aggregation. Read-only.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "accounts"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = new URL(req.url).searchParams;

  try {
    const result = await getNewAccountsOverview({
      sectionId: params.get("sectionId") || undefined,
      addedFrom: params.get("addedFrom") || undefined,
      addedTo: params.get("addedTo") || undefined,
      search: params.get("search") || undefined,
      neverPosted: params.get("neverPosted") === "1",
    });
    return NextResponse.json(result);
  } catch (err: any) {
    const message = err.message || "Failed to load new accounts";
    const status = /YYYY-MM-DD|on or before/.test(message) ? 400 : 500;
    if (status === 500) console.error("[New Accounts API] Error:", err);
    return NextResponse.json({ error: message }, { status });
  }
}
