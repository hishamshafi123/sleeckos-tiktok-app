export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ForbiddenError } from "@/lib/services/analytics/account-performance";
import { getUncapturedPosts } from "@/lib/services/analytics/campaign-activity";

// GET /api/campaigns/[id]/tracking/uncaptured?from=YYYY-MM-DD&to=YYYY-MM-DD
// Published posts of the campaign whose TikTok link was never captured.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    const from = req.nextUrl.searchParams.get("from") ?? undefined;
    const to = req.nextUrl.searchParams.get("to") ?? undefined;
    const result = await getUncapturedPosts(session.userId, id, { from, to });
    if (!result) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[Campaign uncaptured] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
