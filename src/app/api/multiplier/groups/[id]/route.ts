import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import prisma from "@/lib/db";

// PATCH /api/multiplier/groups/[id]
// Body: { campaignId?, styleId?, captionStyleId?, hookPosition?, settings? }
// captionStyleId is an alias for styleId. hookPosition is merged into settings
// (object → merged wholesale; number → settings.positionYPercent).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: groupId } = await params;

  try {
    const body = await req.json();
    const { campaignId, styleId, captionStyleId, hookPosition, settings } = body;

    const group = await prisma.multiplierGroup.findUnique({
      where: { id: groupId },
    });
    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    const data: any = {};

    if (campaignId !== undefined) {
      data.campaignId = campaignId || null;
    }

    const effectiveStyleId = styleId !== undefined ? styleId : captionStyleId;
    if (effectiveStyleId !== undefined) {
      data.styleId = effectiveStyleId;
    }

    if (settings !== undefined || hookPosition !== undefined) {
      const currentSettings = typeof group.settings === "string"
        ? JSON.parse(group.settings)
        : (group.settings || {});

      const merged: any = { ...currentSettings };
      if (settings && typeof settings === "object") {
        Object.assign(merged, settings);
      }
      if (hookPosition !== undefined) {
        if (hookPosition && typeof hookPosition === "object") {
          Object.assign(merged, hookPosition);
        } else if (typeof hookPosition === "number") {
          merged.positionYPercent = hookPosition;
        }
      }
      data.settings = merged;
    }

    const updated = await prisma.multiplierGroup.update({
      where: { id: groupId },
      data,
    });

    return NextResponse.json(updated);
  } catch (err: any) {
    console.error("[Multiplier Group PATCH API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to update group" }, { status: 500 });
  }
}
