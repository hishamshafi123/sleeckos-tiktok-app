export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { generateApiKey } from "@/lib/services/api-clients";

// POST /api/api-clients/[id]/keys — generate a key { label? }.
// The raw key is returned ONCE in this response and never stored retrievably.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await can(session.userId, "campaigns"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { id: keyId, rawKey } = await generateApiKey(
    id,
    typeof body.label === "string" ? body.label : undefined
  );
  return NextResponse.json({ id: keyId, rawKey });
}
