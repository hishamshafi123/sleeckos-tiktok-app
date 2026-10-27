import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import {
  pauseRenderQueue,
  resumeRenderQueue,
  recoverStaleRenderingOutputs,
  triggerQueueWorker,
  getRenderQueueState,
} from "@/lib/services/multiplier";
import { triggerSmartExportWorker } from "@/lib/services/multiplier-export";
import {
  getMultiplierPerformanceState,
  isMultiplierPerformanceMode,
  setMultiplierPerformanceMode,
} from "@/lib/services/multiplier-performance";

// POST /api/multiplier/queue/control — operator control over render/export capacity
// Body: { action: "pause" | "resume" | "recover" | "set-performance-mode", mode? }
//  pause/resume/recover affect only rendering; performance mode updates both pools.
// Current work always finishes; limits apply before the next candidate claim.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { action, mode } = await req.json();

    if (action === "pause") {
      const state = await pauseRenderQueue();
      return NextResponse.json({ success: true, state });
    }

    if (action === "resume") {
      const state = await resumeRenderQueue();
      return NextResponse.json({ success: true, state });
    }

    if (action === "recover") {
      const recovered = await recoverStaleRenderingOutputs();
      triggerQueueWorker();
      return NextResponse.json({ success: true, recovered, state: getRenderQueueState() });
    }

    if (action === "set-performance-mode") {
      if (!isMultiplierPerformanceMode(mode)) {
        return NextResponse.json(
          { error: "Unknown performance mode — use balanced | render_boost | export_boost" },
          { status: 400 }
        );
      }
      await setMultiplierPerformanceMode(mode);
      await Promise.all([triggerQueueWorker(), triggerSmartExportWorker()]);
      const performance = await getMultiplierPerformanceState();
      return NextResponse.json({
        success: true,
        state: { ...getRenderQueueState(), performance },
      });
    }

    return NextResponse.json(
      { error: "Unknown action — use pause | resume | recover | set-performance-mode" },
      { status: 400 }
    );
  } catch (err: unknown) {
    console.error("[Multiplier Queue Control API] Error:", err);
    const message = err instanceof Error ? err.message : "Failed to control render queue";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
