export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { createGroup } from "@/lib/services/multiplier";
import fs from "fs";
import path from "path";

// GET /api/managed/multiplier — List all multiplier groups
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const groups = await prisma.multiplierGroup.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        campaign: {
          select: { id: true, title: true },
        },
        variations: {
          orderBy: { order: "asc" },
        },
        hooks: {
          orderBy: { order: "asc" },
        },
        outputs: {
          orderBy: { createdAt: "asc" },
          include: {
            variation: { select: { videoRef: true } },
            hook: { select: { text: true } },
          },
        },
      },
    });

    return NextResponse.json(groups);
  } catch (err: any) {
    console.error("[Multiplier Group GET API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to fetch groups" }, { status: 500 });
  }
}

// POST /api/managed/multiplier — Create a new group
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { name, campaignId, styleId, mappingMode, settings } = body;

    if (!name || !campaignId || !styleId) {
      return NextResponse.json({ error: "Missing required parameters: name, campaignId, styleId" }, { status: 400 });
    }

    const group = await createGroup({
      name,
      campaignId,
      styleId,
      mappingMode,
      settings,
      createdBy: session.userId,
    });

    return NextResponse.json(group);
  } catch (err: any) {
    console.error("[Multiplier Group POST API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to create group" }, { status: 500 });
  }
}

// DELETE /api/managed/multiplier?groupId=... — Delete a group and its files
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const groupId = searchParams.get("groupId");

  if (!groupId) {
    return NextResponse.json({ error: "Missing groupId" }, { status: 400 });
  }

  try {
    const group = await prisma.multiplierGroup.findUnique({
      where: { id: groupId },
      include: {
        variations: true,
        outputs: true,
      },
    });

    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    const publicDir = path.join(process.cwd(), "public");

    // Clean up variations files
    for (const v of group.variations) {
      const vPath = path.join(publicDir, v.videoRef);
      if (fs.existsSync(vPath)) {
        try { fs.unlinkSync(vPath); } catch {}
      }
    }

    // Clean up output files
    for (const o of group.outputs) {
      if (o.outputRef) {
        const oPath = path.join(publicDir, o.outputRef);
        if (fs.existsSync(oPath)) {
          try { fs.unlinkSync(oPath); } catch {}
        }
      }
    }

    // Delete group (cascade deletes variations, hooks, outputs in DB)
    await prisma.multiplierGroup.delete({
      where: { id: groupId },
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[Multiplier Group DELETE API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to delete group" }, { status: 500 });
  }
}
