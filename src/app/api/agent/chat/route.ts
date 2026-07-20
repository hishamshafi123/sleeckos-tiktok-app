export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { runAgentTurn } from "@/lib/services/agent/agent";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!(await can(session.userId, "agent"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
