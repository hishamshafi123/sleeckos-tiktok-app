import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createSheet } from "@/lib/services/vault";

export const dynamic = "force-dynamic";

// POST: create sheet in folder
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { folderId, name } = body;
    if (!folderId || !name) {
      return NextResponse.json({ error: "Missing folderId or name parameter" }, { status: 400 });
    }

    const sheet = await createSheet(session.userId, folderId, name);
    return NextResponse.json(sheet);
  } catch (err: any) {
    console.error("[Vault Sheets POST] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to create sheet" }, { status: 500 });
  }
}
