export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { revokeApiKey } from "@/lib/services/api-clients";

// DELETE /api/api-clients/[id]/keys/[keyId] — revoke a key (immediate effect).
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; keyId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await can(session.userId, "campaigns"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { keyId } = await params;
  await revokeApiKey(keyId);
  return NextResponse.json({ ok: true });
}
