import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { syncStateAccounts } from "@/lib/services/state-accounts/sync";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  const received = request.headers.get("x-cron-secret");
  if (
    !expected ||
    !received ||
    Buffer.byteLength(expected) !== Buffer.byteLength(received) ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(received))
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    // Await the job so host cron sees actual failures, not a premature 200.
    const result = await syncStateAccounts();
    return NextResponse.json(result, { status: result.failed ? 503 : 200 });
  } catch (error) {
    console.error("[State accounts cron] Failed", error);
    return NextResponse.json(
      { error: "State account sync failed" },
      { status: 500 },
    );
  }
}
