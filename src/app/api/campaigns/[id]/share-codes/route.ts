export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import prisma from "@/lib/db";
import { generateShareCode } from "@/lib/services/track-share";

function serialize(share: {
  id: string;
  code: string;
  label: string | null;
  createdBy: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
}) {
  return {
    id: share.id,
    code: share.code,
    label: share.label,
    createdBy: share.createdBy,
    createdAt: share.createdAt.toISOString(),
    expiresAt: share.expiresAt ? share.expiresAt.toISOString() : null,
    revokedAt: share.revokedAt ? share.revokedAt.toISOString() : null,
  };
}

// GET /api/campaigns/[id]/share-codes — list share codes for a campaign
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "campaigns"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const campaign = await prisma.campaign.findUnique({ where: { id }, select: { id: true } });
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const shares = await prisma.campaignShare.findMany({
      where: { campaignId: id },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ shares: shares.map(serialize) });
  } catch (err: any) {
    console.error("[Campaign Share-Codes GET] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to list share codes" }, { status: 500 });
  }
}

// POST /api/campaigns/[id]/share-codes — create a share code
// Body: { label?: string, expiresAt?: string | null }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "campaigns"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const campaign = await prisma.campaign.findUnique({ where: { id }, select: { id: true } });
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const label = typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 120) : null;

    let expiresAt: Date | null = null;
    if (body.expiresAt) {
      const parsed = new Date(body.expiresAt);
      if (isNaN(parsed.getTime())) {
        return NextResponse.json({ error: "Invalid expiresAt date" }, { status: 400 });
      }
      expiresAt = parsed;
    }

    // Retry on the (astronomically unlikely) unique-code collision
    let share = null;
    for (let attempt = 0; attempt < 5 && !share; attempt++) {
      try {
        share = await prisma.campaignShare.create({
          data: {
            campaignId: id,
            code: generateShareCode(),
            label,
            createdBy: session.userId,
            expiresAt,
          },
        });
      } catch (err: any) {
        if (err?.code !== "P2002") throw err;
      }
    }
    if (!share) {
      return NextResponse.json({ error: "Failed to generate a unique code — try again" }, { status: 500 });
    }

    return NextResponse.json({ share: serialize(share) }, { status: 201 });
  } catch (err: any) {
    console.error("[Campaign Share-Codes POST] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to create share code" }, { status: 500 });
  }
}
