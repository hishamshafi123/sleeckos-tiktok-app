export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { checkAllAccountsHealth } from "@/lib/services/accounts";

function verifyCronSecret(req: NextRequest) {
  const secret =
    req.headers.get("x-cron-secret") ||
    req.nextUrl.searchParams.get("secret");
  return secret === process.env.CRON_SECRET;
}

/**
 * GET /api/cron/accounts-health
 * Triggers health checks, token refreshing, and stats sync for all active accounts.
 */
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    console.log("[Health Cron] Starting managed accounts health routine...");
    const results = await checkAllAccountsHealth();
    return NextResponse.json({
      ok: true,
      message: "Health check completed.",
      results,
    });
  } catch (err: any) {
    console.error("[Health Cron] Health check routine failed:", err.message);
    return NextResponse.json({
      error: "Health check routine failed",
      details: err.message,
    }, { status: 500 });
  }
}
