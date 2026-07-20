export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { postNowForAccount } from "@/lib/services/posting-pipeline";

// POST /api/managed/accounts/[id]/post-now — instantly post next video via PostPeer
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "accounts"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const { jobId, fileName } = await postNowForAccount(id);
    return NextResponse.json({
      ok: true,
      jobId,
      fileName,
      message: `Posting "${fileName}" via PostPeer...`,
    });
  } catch (err: any) {
    const message = err?.message || String(err);
    const status =
      message === "Account not found"
        ? 404
        : message.startsWith("Drive folder ingestion failed")
        ? 500
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
