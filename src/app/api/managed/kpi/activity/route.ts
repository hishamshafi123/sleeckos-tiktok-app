import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import prisma from "@/lib/db";
import { getSelfKpi, getManagerKpi, logManualActivity, exportKpiCsv } from "@/lib/services/kpi_system";
import { getOrgTimezone, getZonedFutureStartOfDay } from "@/lib/services/timezone";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("mode") || "self"; // "self" | "manager"
  const fromStr = searchParams.get("from");
  const toStr = searchParams.get("to");
  const range = searchParams.get("range");
  const functionType = searchParams.get("functionType") || undefined;
  const campaignId = searchParams.get("campaignId") || undefined;
  const exportFormat = searchParams.get("export");

  try {
    if (mode === "self") {
      const kpis = await getSelfKpi(session.userId);
      return NextResponse.json(kpis);
    }

    // Manager View check
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      include: { role: true }
    });
    if (user?.role.key !== "admin" && user?.role.key !== "team_lead") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const tz = await getOrgTimezone();
    let from = fromStr ? new Date(fromStr) : undefined;
    let to = toStr ? new Date(toStr) : undefined;

    if (!from && range) {
      if (range === "day" || range === "today") {
        from = getZonedFutureStartOfDay(tz, 0);
      } else if (range === "week" || range === "this-week") {
        from = getZonedFutureStartOfDay(tz, -((new Date().getDay() + 6) % 7));
      } else if (range === "month" || range === "this-month") {
        from = getZonedFutureStartOfDay(tz, -(new Date().getDate() - 1));
      } else if (range === "all" || range === "all-time") {
        from = new Date(0);
      }
    }

    const managerData = await getManagerKpi({ from, to, functionType, campaignId });

    if (exportFormat === "csv") {
      const csvContent = exportKpiCsv(managerData.rawEvents);
      return new NextResponse(csvContent, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename=sleeckos-kpi-report-${Date.now()}.csv`
        }
      });
    }

    return NextResponse.json(managerData);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load KPI activity" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    
    if (Array.isArray(body)) {
      const results = await Promise.all(
        body.map((item) =>
          logManualActivity(session.userId, item.functionType, parseInt(item.count), {
            campaignId: item.campaignId,
            meta: item.meta,
            createdBy: session.userId,
            approved: true
          })
        )
      );
      return NextResponse.json(results);
    } else {
      const { functionType, count, campaignId, meta } = body;
      if (!functionType || count === undefined) {
        return NextResponse.json({ error: "Missing job functionType or count" }, { status: 400 });
      }

      const result = await logManualActivity(session.userId, functionType, parseInt(count), {
        campaignId,
        meta,
        createdBy: session.userId,
        approved: true
      });
      return NextResponse.json(result);
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to log activity" }, { status: 500 });
  }
}
