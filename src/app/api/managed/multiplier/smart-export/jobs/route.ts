export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import {
  createSmartExportRequestHash,
  findSmartExportJobByRequestKey,
  runSmartExport,
  SmartExportRequestConflictError,
  SmartExportReservationError,
  triggerSmartExportWorker,
} from "@/lib/services/multiplier-export";
import prisma from "@/lib/db";

// POST /api/managed/multiplier/smart-export - Starts a new smart export job
// Body: { groupIds: string[], plan: { driveFolderId: string, driveFolderName: string, videoIds: string[] }[], days?: number, includeExported?: boolean, idempotencyKey?: string }
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await can(session.userId, "multiplier"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const { groupIds, plan, days = 1, includeExported } = body;
    if (!groupIds || !Array.isArray(groupIds) || groupIds.length === 0) {
      return NextResponse.json({ error: "Missing selected Group IDs" }, { status: 400 });
    }
    if (!plan || !Array.isArray(plan) || plan.length === 0) {
      return NextResponse.json({ error: "Missing export assignment plan" }, { status: 400 });
    }
    if (body.idempotencyKey !== undefined &&
        (typeof body.idempotencyKey !== "string" || !body.idempotencyKey.trim() || body.idempotencyKey.trim().length > 128)) {
      return NextResponse.json({ error: "idempotencyKey must be a non-empty string of at most 128 characters" }, { status: 400 });
    }

    const idempotencyKey = body.idempotencyKey?.trim();
    const requestHash = idempotencyKey ? createSmartExportRequestHash({
      groupIds,
      plan,
      days,
      includeExported: !!includeExported,
    }) : undefined;
    if (idempotencyKey) {
      const existing = await findSmartExportJobByRequestKey(idempotencyKey, requestHash);
      if (existing) {
        triggerSmartExportWorker().catch((err) => {
          console.error("[Smart Export Run Route] Failed to retrigger background worker:", err);
        });
        return NextResponse.json({ success: true, jobId: existing.id, replay: true });
      }
    }

    const { job, replayed } = await runSmartExport(session.userId, groupIds, plan, days, {
      idempotencyKey,
      requestHash,
      includeExported: !!includeExported,
    });
    return NextResponse.json({ success: true, jobId: job.id, replay: replayed });
  } catch (err: unknown) {
    console.error("[Smart Export Run Route] Error:", err);
    const status = err instanceof SmartExportRequestConflictError || err instanceof SmartExportReservationError ? 409 : 500;
    const message = err instanceof Error ? err.message : "Failed to launch smart export";
    return NextResponse.json({ error: message }, { status });
  }
}

// GET /api/managed/multiplier/smart-export/jobs - Lists past smart export jobs
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const jobs = await prisma.smartExportJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return NextResponse.json({ jobs });
  } catch (err: unknown) {
    console.error("[Smart Export Jobs Route] Error:", err);
    const message = err instanceof Error ? err.message : "Failed to list jobs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
