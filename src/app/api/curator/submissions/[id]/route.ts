export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { approveCuratorSubmission, rejectCuratorSubmission } from "@/lib/services/projects";
import prisma from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "projects"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: submissionId } = await params;

  try {
    // Only Admin or Team Lead can approve/reject submissions
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      include: { role: true },
    });
    const isManagement = user?.role?.key === "admin" || user?.role?.key === "team_lead";

    if (!isManagement) {
      return NextResponse.json({ error: "Forbidden: Lead status required to process submissions" }, { status: 403 });
    }

    const body = await req.json();
    const { action, feedback, folderId } = body;

    if (action === "APPROVE") {
      // If folderId is provided during approval, assign it first
      if (folderId) {
        await prisma.curatorSubmission.update({
          where: { id: submissionId },
          data: { folderId },
        });
      }
      
      const result = await approveCuratorSubmission(session.userId, submissionId);
      return NextResponse.json(result);
    }

    if (action === "REJECT") {
      if (!feedback || !feedback.trim()) {
        return NextResponse.json({ error: "Feedback is required for rejections" }, { status: 400 });
      }
      const submission = await rejectCuratorSubmission(session.userId, submissionId, feedback.trim());
      return NextResponse.json(submission);
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    console.error("[Submission PATCH] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to process submission" }, { status: 500 });
  }
}
