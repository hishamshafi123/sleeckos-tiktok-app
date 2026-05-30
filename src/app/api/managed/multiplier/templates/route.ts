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
  textAlign: true,
  // Advanced fields
  stripGradientEnabled: true, stripGradientColor2: true, stripGradientAngle: true,
  stripShape: true,
  animationType: true, animationDuration: true,
  backdropBlurEnabled: true, backdropBlurRadius: true,
  textGradientEnabled: true, textGradientColor1: true, textGradientColor2: true, textGradientAngle: true,
  doubleTextEnabled: true, doubleTextOutlineColor: true, doubleTextOutlineWidth: true,
  isPreset: true, presetCategory: true,
  createdAt: true, updatedAt: true,
};

/** Build the data object from a request body for create/update */
function buildTemplateData(body: any) {
  return {
    name: body.name?.trim() || "Untitled",
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
    // ── Advanced ──
    stripGradientEnabled: body.stripGradientEnabled ?? false,
    stripGradientColor2: body.stripGradientColor2 || "#333333",
    stripGradientAngle: body.stripGradientAngle ?? 90,
    stripShape: body.stripShape || "FULL",
    animationType: body.animationType || "NONE",
    animationDuration: body.animationDuration ?? 0.5,
    backdropBlurEnabled: body.backdropBlurEnabled ?? false,
    backdropBlurRadius: body.backdropBlurRadius ?? 10,
    textGradientEnabled: body.textGradientEnabled ?? false,
    textGradientColor1: body.textGradientColor1 || "#FFFFFF",
    textGradientColor2: body.textGradientColor2 || "#00FFFF",
    textGradientAngle: body.textGradientAngle ?? 180,
    doubleTextEnabled: body.doubleTextEnabled ?? false,
    doubleTextOutlineColor: body.doubleTextOutlineColor || "#000000",
    doubleTextOutlineWidth: body.doubleTextOutlineWidth ?? 4,
    isPreset: body.isPreset ?? false,
    presetCategory: body.presetCategory || null,
  };
}

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

// POST /api/managed/multiplier/templates — Create or duplicate a design template
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action");

  try {
    // ── Duplicate action ──────────────────────────────────────────────────
    if (action === "duplicate") {
      const sourceId = searchParams.get("id");
      if (!sourceId) {
        return NextResponse.json({ error: "Missing source template id" }, { status: 400 });
      }

      const source = await prisma.multiplierTemplate.findUnique({ where: { id: sourceId } });
      if (!source) {
        return NextResponse.json({ error: "Source template not found" }, { status: 404 });
      }

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, createdAt, updatedAt, ...rest } = source;
      const duplicate = await prisma.multiplierTemplate.create({
        data: { ...rest, name: `${source.name} (Copy)`, isPreset: false },
      });

      return NextResponse.json(duplicate);
    }

    // ── Seed presets action ────────────────────────────────────────────────
    if (action === "seed-presets") {
      const existing = await prisma.multiplierTemplate.count({ where: { isPreset: true } });
      if (existing > 0) {
        return NextResponse.json({ message: "Presets already exist", count: existing });
      }

      const presets = getBuiltInPresets();
      const created = await prisma.multiplierTemplate.createMany({ data: presets });
      return NextResponse.json({ message: "Presets seeded", count: created.count });
    }

    // ── Normal create ─────────────────────────────────────────────────────
    const body = await req.json();

    if (!body.name || !body.name.trim()) {
      return NextResponse.json({ error: "Template name is required" }, { status: 400 });
    }

    const template = await prisma.multiplierTemplate.create({
      data: buildTemplateData(body),
    });

    return NextResponse.json(template);
  } catch (err) {
    console.error("[Templates API] Create error:", err);
    return NextResponse.json({ error: "Failed to create template" }, { status: 500 });
  }
}

// PUT /api/managed/multiplier/templates — Update an existing design template
export async function PUT(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!body.id) {
      return NextResponse.json({ error: "Missing template id" }, { status: 400 });
    }
    if (!body.name || !body.name.trim()) {
      return NextResponse.json({ error: "Template name is required" }, { status: 400 });
    }

    const template = await prisma.multiplierTemplate.update({
      where: { id: body.id },
      data: buildTemplateData(body),
    });

    return NextResponse.json(template);
  } catch (err) {
    console.error("[Templates API] Update error:", err);
    return NextResponse.json({ error: "Failed to update template" }, { status: 500 });
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

// ─── Built-in Preset Designs ─────────────────────────────────────────────────

function getBuiltInPresets() {
  return [
    {
      name: "Neon Viral",
      isPreset: true, presetCategory: "Bold",
      fontFamily: "Montserrat-Bold", fontSize: 48, fontColor: "#FFFFFF", textCase: "UPPERCASE",
      letterSpacing: 1.2, lineHeight: 1.3,
      strokeEnabled: false, strokeColor: "#000000", strokeWidth: 2,
      shadowEnabled: false, shadowColor: "#000000", shadowX: 2, shadowY: 2,
      glowEnabled: true, glowColor: "#FF00FF", glowIntensity: 3,
      bgStripColor: "#0D0D0D", bgStripOpacity: 0.85, stripWidthMode: "FULL", stripWidthPercent: 100,
      borderRadius: 16,
      stripBorderEnabled: true, stripBorderColor: "#FF00FF", stripBorderWidth: 1,
      stripShadowEnabled: false, stripShadowColor: "#000000", stripShadowOffset: 4,
      positionYPercent: 70, marginX: 20, paddingY: 24, paddingX: 24, textAlign: "CENTER",
      stripGradientEnabled: false, stripGradientColor2: "#333333", stripGradientAngle: 90,
      stripShape: "FULL",
      animationType: "FADE_IN", animationDuration: 0.4,
      backdropBlurEnabled: false, backdropBlurRadius: 10,
      textGradientEnabled: false, textGradientColor1: "#FFFFFF", textGradientColor2: "#00FFFF", textGradientAngle: 180,
      doubleTextEnabled: false, doubleTextOutlineColor: "#000000", doubleTextOutlineWidth: 4,
    },
    {
      name: "Clean Minimal",
      isPreset: true, presetCategory: "Minimal",
      fontFamily: "Inter-Bold", fontSize: 40, fontColor: "#FFFFFF", textCase: "UPPERCASE",
      letterSpacing: 1.0, lineHeight: 1.5,
      strokeEnabled: false, strokeColor: "#000000", strokeWidth: 2,
      shadowEnabled: true, shadowColor: "#000000", shadowX: 1, shadowY: 2,
      glowEnabled: false, glowColor: "#FF00FF", glowIntensity: 2,
      bgStripColor: "#000000", bgStripOpacity: 0.0, stripWidthMode: "FULL", stripWidthPercent: 100,
      borderRadius: 0,
      stripBorderEnabled: false, stripBorderColor: "#FFFFFF", stripBorderWidth: 1,
      stripShadowEnabled: false, stripShadowColor: "#000000", stripShadowOffset: 4,
      positionYPercent: 75, marginX: 30, paddingY: 16, paddingX: 20, textAlign: "CENTER",
      stripGradientEnabled: false, stripGradientColor2: "#333333", stripGradientAngle: 90,
      stripShape: "NONE",
      animationType: "FADE_IN", animationDuration: 0.5,
      backdropBlurEnabled: false, backdropBlurRadius: 10,
      textGradientEnabled: false, textGradientColor1: "#FFFFFF", textGradientColor2: "#00FFFF", textGradientAngle: 180,
      doubleTextEnabled: false, doubleTextOutlineColor: "#000000", doubleTextOutlineWidth: 4,
    },
    {
      name: "Bold Impact",
      isPreset: true, presetCategory: "Bold",
      fontFamily: "Anton-Regular", fontSize: 56, fontColor: "#000000", textCase: "UPPERCASE",
      letterSpacing: 1.1, lineHeight: 1.2,
      strokeEnabled: false, strokeColor: "#000000", strokeWidth: 2,
      shadowEnabled: false, shadowColor: "#000000", shadowX: 2, shadowY: 2,
      glowEnabled: false, glowColor: "#FF00FF", glowIntensity: 2,
      bgStripColor: "#FFD700", bgStripOpacity: 1.0, stripWidthMode: "FULL", stripWidthPercent: 100,
      borderRadius: 4,
      stripBorderEnabled: false, stripBorderColor: "#FFFFFF", stripBorderWidth: 1,
      stripShadowEnabled: true, stripShadowColor: "#000000", stripShadowOffset: 6,
      positionYPercent: 65, marginX: 0, paddingY: 20, paddingX: 28, textAlign: "CENTER",
      stripGradientEnabled: false, stripGradientColor2: "#333333", stripGradientAngle: 90,
      stripShape: "FULL",
      animationType: "SLIDE_UP", animationDuration: 0.4,
      backdropBlurEnabled: false, backdropBlurRadius: 10,
      textGradientEnabled: false, textGradientColor1: "#FFFFFF", textGradientColor2: "#00FFFF", textGradientAngle: 180,
      doubleTextEnabled: false, doubleTextOutlineColor: "#000000", doubleTextOutlineWidth: 4,
    },
    {
      name: "Glassmorphism",
      isPreset: true, presetCategory: "Modern",
      fontFamily: "Outfit-Bold", fontSize: 42, fontColor: "#FFFFFF", textCase: "UPPERCASE",
      letterSpacing: 1.0, lineHeight: 1.4,
      strokeEnabled: false, strokeColor: "#000000", strokeWidth: 2,
      shadowEnabled: false, shadowColor: "#000000", shadowX: 2, shadowY: 2,
      glowEnabled: false, glowColor: "#FF00FF", glowIntensity: 2,
      bgStripColor: "#FFFFFF", bgStripOpacity: 0.15, stripWidthMode: "FULL", stripWidthPercent: 100,
      borderRadius: 20,
      stripBorderEnabled: true, stripBorderColor: "#FFFFFF", stripBorderWidth: 1,
      stripShadowEnabled: false, stripShadowColor: "#000000", stripShadowOffset: 4,
      positionYPercent: 70, marginX: 24, paddingY: 24, paddingX: 24, textAlign: "CENTER",
      stripGradientEnabled: false, stripGradientColor2: "#333333", stripGradientAngle: 90,
      stripShape: "FULL",
      animationType: "FADE_IN", animationDuration: 0.6,
      backdropBlurEnabled: true, backdropBlurRadius: 12,
      textGradientEnabled: false, textGradientColor1: "#FFFFFF", textGradientColor2: "#00FFFF", textGradientAngle: 180,
      doubleTextEnabled: false, doubleTextOutlineColor: "#000000", doubleTextOutlineWidth: 4,
    },
    {
      name: "Gradient Wave",
      isPreset: true, presetCategory: "Modern",
      fontFamily: "Outfit-Bold", fontSize: 44, fontColor: "#FFFFFF", textCase: "UPPERCASE",
      letterSpacing: 1.0, lineHeight: 1.4,
      strokeEnabled: false, strokeColor: "#000000", strokeWidth: 2,
      shadowEnabled: false, shadowColor: "#000000", shadowX: 2, shadowY: 2,
      glowEnabled: false, glowColor: "#FF00FF", glowIntensity: 2,
      bgStripColor: "#4F46E5", bgStripOpacity: 0.9, stripWidthMode: "FULL", stripWidthPercent: 100,
      borderRadius: 16,
      stripBorderEnabled: false, stripBorderColor: "#FFFFFF", stripBorderWidth: 1,
      stripShadowEnabled: false, stripShadowColor: "#000000", stripShadowOffset: 4,
      positionYPercent: 72, marginX: 16, paddingY: 22, paddingX: 22, textAlign: "CENTER",
      stripGradientEnabled: true, stripGradientColor2: "#7C3AED", stripGradientAngle: 135,
      stripShape: "FULL",
      animationType: "SCALE_IN", animationDuration: 0.5,
      backdropBlurEnabled: false, backdropBlurRadius: 10,
      textGradientEnabled: false, textGradientColor1: "#FFFFFF", textGradientColor2: "#00FFFF", textGradientAngle: 180,
      doubleTextEnabled: false, doubleTextOutlineColor: "#000000", doubleTextOutlineWidth: 4,
    },
    {
      name: "Dark Cinematic",
      isPreset: true, presetCategory: "Cinematic",
      fontFamily: "PlayfairDisplay-Bold", fontSize: 38, fontColor: "#D4AF37", textCase: "capitalize",
      letterSpacing: 1.3, lineHeight: 1.5,
      strokeEnabled: false, strokeColor: "#000000", strokeWidth: 2,
      shadowEnabled: true, shadowColor: "#000000", shadowX: 2, shadowY: 3,
      glowEnabled: false, glowColor: "#FF00FF", glowIntensity: 2,
      bgStripColor: "#0A0A0A", bgStripOpacity: 0.9, stripWidthMode: "FULL", stripWidthPercent: 100,
      borderRadius: 8,
      stripBorderEnabled: true, stripBorderColor: "#D4AF37", stripBorderWidth: 1,
      stripShadowEnabled: false, stripShadowColor: "#000000", stripShadowOffset: 4,
      positionYPercent: 68, marginX: 28, paddingY: 24, paddingX: 28, textAlign: "CENTER",
      stripGradientEnabled: true, stripGradientColor2: "#1A1A2E", stripGradientAngle: 180,
      stripShape: "FULL",
      animationType: "FADE_IN", animationDuration: 0.7,
      backdropBlurEnabled: false, backdropBlurRadius: 10,
      textGradientEnabled: false, textGradientColor1: "#FFFFFF", textGradientColor2: "#00FFFF", textGradientAngle: 180,
      doubleTextEnabled: false, doubleTextOutlineColor: "#000000", doubleTextOutlineWidth: 4,
    },
    {
      name: "Street Bold",
      isPreset: true, presetCategory: "Bold",
      fontFamily: "Oswald-Bold", fontSize: 50, fontColor: "#FFFFFF", textCase: "UPPERCASE",
      letterSpacing: 1.0, lineHeight: 1.2,
      strokeEnabled: false, strokeColor: "#000000", strokeWidth: 2,
      shadowEnabled: false, shadowColor: "#000000", shadowX: 2, shadowY: 2,
      glowEnabled: false, glowColor: "#FF00FF", glowIntensity: 2,
      bgStripColor: "#DC2626", bgStripOpacity: 0.95, stripWidthMode: "FULL", stripWidthPercent: 100,
      borderRadius: 28,
      stripBorderEnabled: false, stripBorderColor: "#FFFFFF", stripBorderWidth: 1,
      stripShadowEnabled: false, stripShadowColor: "#000000", stripShadowOffset: 4,
      positionYPercent: 70, marginX: 40, paddingY: 20, paddingX: 28, textAlign: "CENTER",
      stripGradientEnabled: false, stripGradientColor2: "#333333", stripGradientAngle: 90,
      stripShape: "PILL",
      animationType: "SLIDE_UP", animationDuration: 0.3,
      backdropBlurEnabled: false, backdropBlurRadius: 10,
      textGradientEnabled: false, textGradientColor1: "#FFFFFF", textGradientColor2: "#00FFFF", textGradientAngle: 180,
      doubleTextEnabled: true, doubleTextOutlineColor: "#7F1D1D", doubleTextOutlineWidth: 3,
    },
    {
      name: "Pastel Soft",
      isPreset: true, presetCategory: "Minimal",
      fontFamily: "Lora-Bold", fontSize: 36, fontColor: "#1E1E2E", textCase: "capitalize",
      letterSpacing: 1.0, lineHeight: 1.6,
      strokeEnabled: false, strokeColor: "#000000", strokeWidth: 2,
      shadowEnabled: false, shadowColor: "#000000", shadowX: 2, shadowY: 2,
      glowEnabled: false, glowColor: "#FF00FF", glowIntensity: 2,
      bgStripColor: "#FBC4E0", bgStripOpacity: 0.9, stripWidthMode: "FULL", stripWidthPercent: 100,
      borderRadius: 24,
      stripBorderEnabled: false, stripBorderColor: "#FFFFFF", stripBorderWidth: 1,
      stripShadowEnabled: false, stripShadowColor: "#000000", stripShadowOffset: 4,
      positionYPercent: 72, marginX: 32, paddingY: 22, paddingX: 26, textAlign: "CENTER",
      stripGradientEnabled: false, stripGradientColor2: "#333333", stripGradientAngle: 90,
      stripShape: "FULL",
      animationType: "FADE_IN", animationDuration: 0.6,
      backdropBlurEnabled: false, backdropBlurRadius: 10,
      textGradientEnabled: false, textGradientColor1: "#FFFFFF", textGradientColor2: "#00FFFF", textGradientAngle: 180,
      doubleTextEnabled: false, doubleTextOutlineColor: "#000000", doubleTextOutlineWidth: 4,
    },
  ];
}
