export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { getLyricGenerations } from "@/lib/services/lyric-generator";

/**
 * GET /api/managed/genres/lyric-generator/history
 * 
 * Returns all LyricGeneration records for re-download.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "composer"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const generations = await getLyricGenerations(100);
    return NextResponse.json(generations);
  } catch (err: any) {
    console.error("[LyricGenerator] History error:", err);
    return NextResponse.json({ error: err.message || "Failed to fetch history" }, { status: 500 });
  }
}
