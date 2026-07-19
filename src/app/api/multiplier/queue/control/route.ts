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

// POST /api/multiplier/queue/control — operator control over the render queue
// Body: { action: "pause" | "resume" | "recover" }
//  pause   — worker finishes the current video, then stops picking up new ones
//  resume  — clears the pause, recovers outputs stuck in RENDERING, restarts the worker
//  recover — resets stale RENDERING outputs to PENDING and kicks the worker (no unpause)
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { action } = await req.json();

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

    return NextResponse.json({ error: "Unknown action — use pause | resume | recover" }, { status: 400 });
  } catch (err: any) {
    console.error("[Multiplier Queue Control API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to control render queue" }, { status: 500 });
  }
}
