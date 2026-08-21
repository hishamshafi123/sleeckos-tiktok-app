export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import {
  ForbiddenError,
  SpotCheckGuardrailError,
  getSpotCheckSample,
  startSpotCheckRun,
  executeSpotCheck,
} from "@/lib/services/analytics/spot-check";

function parseIds(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === "string");
  if (typeof raw === "string") return raw.split(",").filter(Boolean);
  return [];
}

function handle(err: any, label: string) {
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (err instanceof SpotCheckGuardrailError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  console.error(`[AccountPerformance spot-check ${label}] Error:`, err);
  return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
}

// GET /api/admin/account-performance/spot-check?campaignIds=a,b&sampleSize=25
// Free preview of the sample — DB only, no provider spend.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const campaignIds = parseIds(req.nextUrl.searchParams.get("campaignIds"));
  const sampleSize = Number(req.nextUrl.searchParams.get("sampleSize"));

  try {
    const sample = await getSpotCheckSample(session.userId, campaignIds, sampleSize);
    return NextResponse.json(sample);
  } catch (err: any) {
    return handle(err, "GET");
  }
}

// POST /api/admin/account-performance/spot-check { campaignIds, sampleSize }
// Starts a paid run (capture missing links + refresh captured videos) in the
// BACKGROUND — the work outlasts a gateway timeout on real data. Returns
// { runId, status: "running" } immediately; poll GET .../spot-check/[runId].
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const campaignIds = parseIds(body?.campaignIds);
    const sampleSize = Number(body?.sampleSize);
    const { runId } = await startSpotCheckRun(session.userId, campaignIds, sampleSize);

    // executeSpotCheck never throws on work failures (it marks the run row
    // "failed"); the catch here is just a last-resort log.
    (async () => {
      try {
        await executeSpotCheck(runId);
      } catch (err) {
        console.error("[AccountPerformance spot-check] Background run failed:", err);
      }
    })();

    return NextResponse.json({ runId, status: "running" });
  } catch (err: any) {
    return handle(err, "POST");
  }
}
