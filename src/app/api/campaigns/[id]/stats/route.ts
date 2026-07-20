export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import prisma from "@/lib/db";
import { getOrgTimezone, getZonedDateString, getZonedFutureStartOfDay } from "@/lib/services/timezone";

const VALID_RANGES = ["today", "7d", "30d", "all"] as const;
type StatsRange = (typeof VALID_RANGES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ALL_RANGE_DAYS = 90;

type BucketKey = "exported" | "posted" | "failed";

function eventTypeToBucketKey(type: string): BucketKey | null {
  if (type === "export") return "exported";
  if (type === "post_success") return "posted";
  if (type === "post_failed") return "failed";
  return null;
}

// GET /api/campaigns/[id]/stats?range=today|7d|30d|all
// totals      → lifetime Campaign counters (NOT range-limited)
// rangeTotals → CampaignEvent sums within the selected range
// daily       → per-day buckets in the org timezone, ascending, zero-filled
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "campaigns"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const rangeParam = new URL(req.url).searchParams.get("range") || "7d";
  if (!(VALID_RANGES as readonly string[]).includes(rangeParam)) {
    return NextResponse.json(
      { error: `Invalid range "${rangeParam}" — expected today|7d|30d|all` },
      { status: 400 }
    );
  }
  const range = rangeParam as StatsRange;

  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      select: { id: true, exportedCount: true, postedCount: true, failedCount: true },
    });
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const tz = await getOrgTimezone();

    // Number of day buckets ending today (org timezone)
    let days = 1;
    if (range === "7d") {
      days = 7;
    } else if (range === "30d") {
      days = 30;
    } else if (range === "all") {
      const firstEvent = await prisma.campaignEvent.findFirst({
        where: { campaignId: id },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      });
      if (firstEvent) {
        // Compare YYYY-MM-DD strings parsed as UTC → whole-day difference
        const firstDay = Date.parse(getZonedDateString(firstEvent.createdAt, tz));
        const today = Date.parse(getZonedDateString(new Date(), tz));
        days = Math.floor((today - firstDay) / DAY_MS) + 1;
      }
      days = Math.min(days, MAX_ALL_RANGE_DAYS);
    }

    const rangeStart = getZonedFutureStartOfDay(tz, -(days - 1));

    const [rangeEvents, recentEvents] = await Promise.all([
      prisma.campaignEvent.findMany({
        where: { campaignId: id, createdAt: { gte: rangeStart } },
        select: { type: true, count: true, createdAt: true },
      }),
      prisma.campaignEvent.findMany({
        where: { campaignId: id },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);

    // Zero-filled per-day buckets, ascending (oldest → newest)
    const dates: string[] = [];
    const bucketByDate = new Map<string, Record<BucketKey, number>>();
    for (let offset = days - 1; offset >= 0; offset--) {
      const date = getZonedDateString(getZonedFutureStartOfDay(tz, -offset), tz);
      dates.push(date);
      bucketByDate.set(date, { exported: 0, posted: 0, failed: 0 });
    }

    const rangeTotals: Record<BucketKey, number> = { exported: 0, posted: 0, failed: 0 };
    for (const e of rangeEvents) {
      const key = eventTypeToBucketKey(e.type);
      if (!key) continue;
      rangeTotals[key] += e.count;
      const bucket = bucketByDate.get(getZonedDateString(e.createdAt, tz));
      if (bucket) bucket[key] += e.count;
    }

    const attempted = campaign.postedCount + campaign.failedCount;
    const postSuccessRate =
      attempted > 0 ? Math.round((campaign.postedCount / attempted) * 100) : 0;

    return NextResponse.json({
      totals: {
        exported: campaign.exportedCount,
        posted: campaign.postedCount,
        failed: campaign.failedCount,
        postSuccessRate,
      },
      rangeTotals,
      daily: dates.map((date) => ({ date, ...bucketByDate.get(date)! })),
      recentEvents: recentEvents.map((e) => ({
        id: e.id,
        type: e.type,
        count: e.count,
        meta: e.meta,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  } catch (err: any) {
    console.error("[Campaign Stats API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to load campaign stats" }, { status: 500 });
  }
}
