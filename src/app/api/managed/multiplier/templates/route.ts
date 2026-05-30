export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";

// All design template fields (for create/read)
const TEMPLATE_FIELDS = {
  id: true, name: true,
  fontFamily: true, fontSize: true, fontColor: true, textCase: true,
  letterSpacing: true, lineHeight: true,
  strokeEnabled: true, strokeColor: true, strokeWidth: true,
  shadowEnabled: true, shadowColor: true, shadowX: true, shadowY: true,
  glowEnabled: true, glowColor: true, glowIntensity: true,
  bgStripColor: true, bgStripOpacity: true,
  stripWidthMode: true, stripWidthPercent: true, borderRadius: true,
  stripBorderEnabled: true, stripBorderColor: true, stripBorderWidth: true,
  stripShadowEnabled: true, stripShadowColor: true, stripShadowOffset: true,
  positionYPercent: true, marginX: true, paddingY: true, paddingX: true,
  textAlign: true, createdAt: true, updatedAt: true,
};

// GET /api/managed/multiplier/templates — List all design templates
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const templates = await prisma.multiplierTemplate.findMany({
      orderBy: { createdAt: "desc" },
      select: TEMPLATE_FIELDS,
    });
    return NextResponse.json(templates);
  } catch (err) {
    console.error("[Templates API] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// POST /api/managed/multiplier/templates — Create a design template
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!body.name || !body.name.trim()) {
      return NextResponse.json({ error: "Template name is required" }, { status: 400 });
    }

    const template = await prisma.multiplierTemplate.create({
      data: {
        name: body.name.trim(),
        // Typography
        fontFamily: body.fontFamily || "Outfit-Bold",
        fontSize: body.fontSize ?? 42,
        fontColor: body.fontColor || "#FFFFFF",
        textCase: body.textCase || "UPPERCASE",
        letterSpacing: body.letterSpacing ?? 1.0,
        lineHeight: body.lineHeight ?? 1.4,
        // Stroke
        strokeEnabled: body.strokeEnabled ?? false,
        strokeColor: body.strokeColor || "#000000",
        strokeWidth: body.strokeWidth ?? 2,
        // Shadow
        shadowEnabled: body.shadowEnabled ?? false,
        shadowColor: body.shadowColor || "#000000",
        shadowX: body.shadowX ?? 2,
        shadowY: body.shadowY ?? 2,
        // Glow
        glowEnabled: body.glowEnabled ?? false,
        glowColor: body.glowColor || "#FF00FF",
        glowIntensity: body.glowIntensity ?? 2,
        // Strip
        bgStripColor: body.bgStripColor || "#000000",
        bgStripOpacity: body.bgStripOpacity ?? 1.0,
        stripWidthMode: body.stripWidthMode || "FULL",
        stripWidthPercent: body.stripWidthPercent ?? 100,
        borderRadius: body.borderRadius ?? 12,
        stripBorderEnabled: body.stripBorderEnabled ?? false,
        stripBorderColor: body.stripBorderColor || "#FFFFFF",
        stripBorderWidth: body.stripBorderWidth ?? 1,
        stripShadowEnabled: body.stripShadowEnabled ?? false,
        stripShadowColor: body.stripShadowColor || "#000000",
        stripShadowOffset: body.stripShadowOffset ?? 4,
        // Layout
        positionYPercent: body.positionYPercent ?? 5,
        marginX: body.marginX ?? 0,
        paddingY: body.paddingY ?? 20,
        paddingX: body.paddingX ?? 20,
        textAlign: body.textAlign || "CENTER",
      },
    });

    return NextResponse.json(template);
  } catch (err) {
    console.error("[Templates API] Create error:", err);
    return NextResponse.json({ error: "Failed to create template" }, { status: 500 });
  }
}

// DELETE /api/managed/multiplier/templates?id=...
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Missing template id" }, { status: 400 });
  }

  try {
    await prisma.multiplierTemplate.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Templates API] Delete error:", err);
    return NextResponse.json({ error: "Failed to delete template" }, { status: 500 });
  }
}
