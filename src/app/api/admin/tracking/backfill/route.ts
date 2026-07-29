export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { backfillTrackedVideos } from "@/lib/services/analytics/backfill";

// POST /api/admin/tracking/backfill — one-off: turn already-linked posts
// (ScheduledPost.tiktokPostUrl from the old Refresh Links flow) into
// TrackedVideos. Admin-only.
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await backfillTrackedVideos();
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error("[Tracking Backfill] Error:", err);
    return NextResponse.json({ error: err.message || "Backfill failed" }, { status: 500 });
  }
}
