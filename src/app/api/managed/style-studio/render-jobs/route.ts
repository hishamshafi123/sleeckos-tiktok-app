export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { queueRenderJob } from "@/lib/services/style-studio";
import prisma from "@/lib/db";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "style_studio"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { savedStyleId, inputProps } = body;
    if (!savedStyleId) {
      return NextResponse.json({ error: "Missing savedStyleId" }, { status: 400 });
    }

    const job = await queueRenderJob(savedStyleId, inputProps || {});
    return NextResponse.json(job, { status: 201 });
  } catch (err: any) {
    console.error("[Render Jobs POST] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to queue render job" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "style_studio"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  try {
    const job = await prisma.styleRenderJob.findUnique({
      where: { id: jobId }
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    return NextResponse.json(job);
  } catch (err: any) {
    console.error("[Render Jobs GET] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to check job status" }, { status: 500 });
  }
}
