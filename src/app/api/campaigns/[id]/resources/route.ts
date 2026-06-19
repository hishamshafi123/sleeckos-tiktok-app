export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { addCampaignResource, deleteCampaignResource } from "@/lib/services/campaigns";

// POST /api/campaigns/[id]/resources — Add a new resource
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

  const { id: campaignId } = await params;
  try {
    const body = await req.json();
    if (!body.label || !body.url || !body.type) {
      return NextResponse.json({ error: "Label, url, and type are required" }, { status: 400 });
    }

    const resource = await addCampaignResource(campaignId, {
      label: body.label,
      url: body.url,
      type: body.type,
    });

    return NextResponse.json(resource, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/campaigns/[id]/resources — Delete a resource by resourceId
export async function DELETE(
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

  const searchParams = req.nextUrl.searchParams;
  const resourceId = searchParams.get("resourceId");

  if (!resourceId) {
    return NextResponse.json({ error: "resourceId query parameter is required" }, { status: 400 });
  }

  try {
    await deleteCampaignResource(resourceId);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
