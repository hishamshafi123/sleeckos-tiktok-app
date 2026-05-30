export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";

// GET /api/managed/multiplier/templates — List all templates
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const templates = await prisma.multiplierTemplate.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(templates);
  } catch (err) {
    console.error("[Templates API] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// POST /api/managed/multiplier/templates — Create a template
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { name, hooks } = await req.json();

    if (!name || !name.trim()) {
      return NextResponse.json({ error: "Template name is required" }, { status: 400 });
    }
    if (!hooks || !Array.isArray(hooks) || hooks.length === 0) {
      return NextResponse.json({ error: "At least one hook is required" }, { status: 400 });
    }

    const cleanHooks = hooks
      .map((h: string) => String(h).trim())
      .filter((h: string) => h.length > 0);

    const template = await prisma.multiplierTemplate.create({
      data: {
        name: name.trim(),
        hooks: JSON.stringify(cleanHooks),
        hookCount: cleanHooks.length,
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
