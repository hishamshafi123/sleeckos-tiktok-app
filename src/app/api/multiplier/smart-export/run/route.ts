import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import {
  createSmartExportRequestHash,
  findSmartExportJobByRequestKey,
  previewSmartExportAccounts,
  runSmartExport,
  SmartExportRequestConflictError,
  SmartExportReservationError,
  triggerSmartExportWorker,
} from "@/lib/services/multiplier-export";

// POST /api/multiplier/smart-export/run
// Body: { groupIds: string[], accounts: { driveFolderId: string, name?: string, count: number }[], days?: number = 1, includeExported?: boolean, countsAreTotal?: boolean, idempotencyKey?: string }
// Computes the feasible plan server-side, then starts the export job.
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
    const { groupIds, accounts, days = 1, includeExported, countsAreTotal = false } = body;
    if (!groupIds || !Array.isArray(groupIds) || groupIds.length === 0) {
      return NextResponse.json({ error: "Missing selected Group IDs" }, { status: 400 });
    }
    if (!accounts || !Array.isArray(accounts)) {
      return NextResponse.json({ error: "Missing account allocations" }, { status: 400 });
    }
    if (body.idempotencyKey !== undefined &&
        (typeof body.idempotencyKey !== "string" || !body.idempotencyKey.trim() || body.idempotencyKey.trim().length > 128)) {
      return NextResponse.json({ error: "idempotencyKey must be a non-empty string of at most 128 characters" }, { status: 400 });
    }

    const idempotencyKey = body.idempotencyKey?.trim();
    const jobDays = Math.max(1, Math.floor(days) || 1);
    const requestHash = idempotencyKey ? createSmartExportRequestHash({
      groupIds,
      accounts,
      days: jobDays,
      includeExported: !!includeExported,
      countsAreTotal: !!countsAreTotal,
    }) : undefined;

    if (idempotencyKey) {
      const existing = await findSmartExportJobByRequestKey(idempotencyKey, requestHash);
      if (existing) {
        triggerSmartExportWorker().catch((err) => {
          console.error("[Smart Export Run API] Failed to retrigger background worker:", err);
        });
        return NextResponse.json({ jobId: existing.id, replay: true });
      }
    }

    const preview = await previewSmartExportAccounts({
      groupIds,
      accounts,
      days: countsAreTotal ? 1 : jobDays,
      includeExported: !!includeExported,
    });

    const plan = preview.assignments.filter((a) => a.videoIds.length > 0);
    if (plan.length === 0) {
      if (idempotencyKey) {
        const existing = await findSmartExportJobByRequestKey(idempotencyKey, requestHash);
        if (existing) {
          triggerSmartExportWorker().catch((err) => {
            console.error("[Smart Export Run API] Failed to retrigger background worker:", err);
          });
          return NextResponse.json({
            jobId: existing.id,
            budget: preview.videoBudget,
            unfulfillable: preview.unfulfillable,
            replay: true,
          });
        }
      }
      return NextResponse.json(
        { error: "No fulfillable account allocations — nothing to export", budget: preview.videoBudget, unfulfillable: preview.unfulfillable },
        { status: 400 }
      );
    }

    const { job, replayed } = await runSmartExport(session.userId, groupIds, plan, jobDays, {
      idempotencyKey,
      requestHash,
      includeExported: !!includeExported,
    });

    return NextResponse.json({
      jobId: job.id,
      budget: preview.videoBudget,
      unfulfillable: preview.unfulfillable,
      replay: replayed,
    });
  } catch (err: unknown) {
    console.error("[Smart Export Run API] Error:", err);
    const status = err instanceof SmartExportRequestConflictError || err instanceof SmartExportReservationError ? 409 : 500;
    const message = err instanceof Error ? err.message : "Failed to launch smart export";
    return NextResponse.json({ error: message }, { status });
  }
}
