export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { runAgentTurn } from "@/lib/services/agent/agent";
import prisma from "@/lib/db";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Only admin/team_lead can use the agent
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { role: true },
  });
  if (user?.role.key !== "admin" && user?.role.key !== "team_lead") {
    return NextResponse.json({ error: "Agent access is restricted to admin and team leads" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { message, history } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const conversationHistory = Array.isArray(history) ? history : [];

    const response = await runAgentTurn(session.userId, message, conversationHistory);
    return NextResponse.json(response);
  } catch (err: any) {
    console.error("[Agent Chat] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
