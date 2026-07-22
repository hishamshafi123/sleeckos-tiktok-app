export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import {
  pauseFactoryQueue,
  resumeFactoryQueue,
  recoverStaleFactoryItems,
  triggerFactoryWorker,
  getFactoryQueueState,
} from "@/lib/services/factory";

/**
 * POST /api/factory/queue/control — operator control over the render queue.
 * Body: { action: "pause" | "resume" | "recover" }
 *  pause   — worker finishes the current item, then stops picking up new ones
 *  resume  — clears the pause, recovers items stuck in RENDERING, restarts the worker
 *  recover — resets stale RENDERING items to PENDING and kicks the worker (no unpause)
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "composer"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { action } = await req.json();

    if (action === "pause") {
      const state = await pauseFactoryQueue();
      return NextResponse.json({ success: true, state });
    }

    if (action === "resume") {
      const state = await resumeFactoryQueue();
      return NextResponse.json({ success: true, state });
    }

    if (action === "recover") {
      const recovered = await recoverStaleFactoryItems();
      triggerFactoryWorker();
      return NextResponse.json({ success: true, recovered, state: getFactoryQueueState() });
    }

    return NextResponse.json({ error: "Unknown action — use pause | resume | recover" }, { status: 400 });
  } catch (err: any) {
    console.error("[Factory Queue Control API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to control render queue" }, { status: 500 });
  }
}
