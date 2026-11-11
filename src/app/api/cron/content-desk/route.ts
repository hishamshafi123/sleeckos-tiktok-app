import { runClipJobs } from "@/lib/services/content-clips/worker";
import { timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { runDesk } from "@/lib/services/content-desk/worker";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 600;
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET,
    received = request.headers.get("x-cron-secret");
  if (
    !expected ||
    !received ||
    Buffer.byteLength(expected) !== Buffer.byteLength(received) ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(received))
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    after(async () => {
      await runClipJobs(2);
    });
    const result = await runDesk();
    return NextResponse.json(result, { status: result.failed ? 207 : 200 });
  } catch (error) {
    console.error("[Content Desk] Worker failed", error);
    return NextResponse.json(
      {
        error:
          "Content collection failed. Check server logs and the Activity tab.",
      },
      { status: 500 },
    );
  }
}
