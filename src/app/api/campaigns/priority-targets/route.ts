export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import {
  NoActivePriorityPoolError,
  splitPriorityTargets,
} from "@/lib/services/campaign-priority";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "campaigns"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { action?: unknown; totalPosts?: unknown };
  try {
    body = await req.json() as { action?: unknown; totalPosts?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const totalPosts = body.totalPosts;
  if (body.action !== "split") {
    return NextResponse.json({ error: "action must be 'split'" }, { status: 400 });
  }
  if (typeof totalPosts !== "number" || !Number.isSafeInteger(totalPosts) || totalPosts <= 0) {
    return NextResponse.json(
      { error: "totalPosts must be a positive safe integer" },
      { status: 400 }
    );
  }

  try {
    const pool = await splitPriorityTargets(totalPosts);
    return NextResponse.json({ pool, dailyTargetTotal: totalPosts });
  } catch (err: unknown) {
    if (err instanceof NoActivePriorityPoolError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof RangeError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[Campaign Priority Targets POST] Error:", err);
    const message = err instanceof Error ? err.message : "Failed to split priority targets";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
