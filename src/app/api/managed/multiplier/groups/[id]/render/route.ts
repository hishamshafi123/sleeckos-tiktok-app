import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { startGroupRender, retryOutput, applyStyleSplitToGroup } from "@/lib/services/multiplier";
import prisma from "@/lib/db";

// POST /api/managed/multiplier/groups/[id]/render — Trigger rendering for the group
export async function POST(
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
    const group = await prisma.multiplierGroup.findUnique({
      where: { id: groupId },
    });
    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    const { mappingMode, styleId, styleIds, settings } = await req.json();

    // Multi-preset split: persist a round-robin per-variation assignment
    // before outputs are mapped (decided at build time, not mid-render).
    // The split function sets group.styleId to the first preset itself.
    const cleanStyleIds: string[] = Array.isArray(styleIds)
      ? styleIds.filter((s: unknown) => typeof s === "string")
      : [];
    if (cleanStyleIds.length > 0) {
      await applyStyleSplitToGroup(groupId, cleanStyleIds);
    }

    // Dynamically update mapping configuration if changed
    await prisma.multiplierGroup.update({
      where: { id: groupId },
      data: {
        mappingMode: mappingMode || group.mappingMode,
        ...(cleanStyleIds.length > 0 ? {} : { styleId: styleId || group.styleId }),
        settings: settings || group.settings,
      },
    });

    await startGroupRender(groupId);
    return NextResponse.json({ success: true, message: "Rendering scheduled in background queue" });
  } catch (err: any) {
    console.error("[Multiplier Render POST API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to start rendering" }, { status: 500 });
  }
}

// PUT /api/managed/multiplier/groups/[id]/render — Retry a failed output item
export async function PUT(
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

  try {
    const { outputId } = await req.json();
    if (!outputId) {
      return NextResponse.json({ error: "Missing outputId" }, { status: 400 });
    }

    const output = await retryOutput(outputId);
    return NextResponse.json({ success: true, output });
  } catch (err: any) {
    console.error("[Multiplier Render PUT API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to retry output render" }, { status: 500 });
  }
}

// GET /api/managed/multiplier/groups/[id]/render — Poll outputs status details
export async function GET(
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
    const group = await prisma.multiplierGroup.findUnique({
      where: { id: groupId },
      include: {
        outputs: {
          orderBy: { createdAt: "asc" },
          include: {
            variation: true,
            hook: true,
          },
        },
      },
    });

    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    return NextResponse.json({
      status: group.status,
      errorMessage: group.errorMessage,
      outputs: group.outputs,
    });
  } catch (err: any) {
    console.error("[Multiplier Render GET API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to fetch render status" }, { status: 500 });
  }
}
