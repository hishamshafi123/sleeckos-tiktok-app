export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { createChatMessage } from "@/lib/services/projects";
import prisma from "@/lib/db";

export async function GET(
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

  const { id: projectId } = await params;
  const taskId = req.nextUrl.searchParams.get("taskId");

  try {
    const messages = await prisma.chatMessage.findMany({
      where: {
        projectId,
        taskId: taskId || null,
      },
      include: {
        author: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json(messages);
  } catch (err: any) {
    console.error("[Chat GET] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to load chat messages" }, { status: 500 });
  }
}

export async function POST(
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

  const { id: projectId } = await params;

  try {
    const body = await req.json();
    const { messageBody, taskId } = body;

    if (!messageBody || !messageBody.trim()) {
      return NextResponse.json({ error: "Message body is empty" }, { status: 400 });
    }

    const message = await createChatMessage(
      session.userId,
      projectId,
      messageBody,
      taskId
    );

    return NextResponse.json(message, { status: 201 });
  } catch (err: any) {
    console.error("[Chat POST] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to send message" }, { status: 500 });
  }
}
