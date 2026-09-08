export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { addManualLinks } from "@/lib/services/analytics/manual-links";

// POST /api/campaigns/[id]/tracking/links  { links: "<pasted text>" }
// Manually add TikTok video links to the campaign: creates TrackedVideo rows
// and immediately pulls current stats (one batched provider call). Returns a
// per-link outcome list.
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

    const body = await req.json();
    const links = typeof body?.links === "string" ? body.links : "";
    if (!links.trim()) {
      return NextResponse.json({ error: "links (pasted text) is required" }, { status: 400 });
    }

    const summary = await addManualLinks(id, links);
    return NextResponse.json(summary);
  } catch (error: any) {
    console.error("[Manual links POST] Error:", error);
    const msg = error?.message || "Internal Server Error";
    // Input problems (no links found, too many) are client errors.
    const status = /No TikTok video links|Too many links/.test(msg) ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
