export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import prisma from "@/lib/db";

// POST /api/campaigns/[id]/share-codes/[shareId]/revoke — revoke a share code
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; shareId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "campaigns"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, shareId } = await params;

  try {
    const share = await prisma.campaignShare.findUnique({ where: { id: shareId } });
    if (!share || share.campaignId !== id) {
      return NextResponse.json({ error: "Share code not found" }, { status: 404 });
    }

    const revoked = share.revokedAt
      ? share
      : await prisma.campaignShare.update({
          where: { id: shareId },
          data: { revokedAt: new Date() },
        });

    return NextResponse.json({
      share: {
        id: revoked.id,
        code: revoked.code,
        revokedAt: revoked.revokedAt ? revoked.revokedAt.toISOString() : null,
      },
    });
  } catch (err: any) {
    console.error("[Campaign Share-Codes Revoke] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to revoke share code" }, { status: 500 });
  }
}
