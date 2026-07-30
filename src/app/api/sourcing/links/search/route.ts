export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { searchSourcedVideos } from "@/lib/services/sourcing";

// GET /api/sourcing/links/search?q= — URL history search
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "sourcing"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ error: "q is required" }, { status: 400 });
  }

  const videos = await searchSourcedVideos(q);
  return NextResponse.json(videos);
}
