export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { generateVerificationLink } from "@/lib/services/telegram";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const link = await generateVerificationLink(session.userId);
    return NextResponse.json({ link });
  } catch (err: any) {
    console.error("[Telegram Verify POST] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to generate link" }, { status: 500 });
  }
}
