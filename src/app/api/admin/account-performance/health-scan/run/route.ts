export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ForbiddenError } from "@/lib/services/analytics/account-performance";
import {
  ScanAlreadyRunningError,
  runHealthScan,
  type HealthThresholds,
} from "@/lib/services/account-health";

const CLAMPS: Record<keyof HealthThresholds, [number, number]> = {
  viewFloor: [1, 100000],
  sampleSize: [2, 10],
  matureAgeHours: [1, 168],
  staleDays: [1, 14],
  notPostingDays: [1, 30],
};

function parseThresholds(body: any): Partial<HealthThresholds> {
  const out: Partial<HealthThresholds> = {};
  const raw = body?.thresholds ?? body ?? {};
  for (const key of Object.keys(CLAMPS) as (keyof HealthThresholds)[]) {
    const v = Number(raw?.[key]);
    if (Number.isFinite(v)) {
      const [min, max] = CLAMPS[key];
      out[key] = Math.min(max, Math.max(min, Math.round(v)));
    }
  }
  return out;
}

// POST /api/admin/account-performance/health-scan/run
// Starts a background health scan over every managed account. Poll
// GET .../health-scan/status for progress, GET .../health-scan/latest for
// results once finished.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const result = await runHealthScan(session.userId, parseThresholds(body));
    return NextResponse.json(result);
  } catch (err: any) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (err instanceof ScanAlreadyRunningError) {
      return NextResponse.json({ error: "Scan already running" }, { status: 409 });
    }
    console.error("[HealthScan run] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
