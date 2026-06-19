export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { getStyleTemplates, createStyleTemplate } from "@/lib/services/style-studio";
import prisma from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "style_studio"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const templates = await getStyleTemplates();
    return NextResponse.json(templates);
  } catch (err: any) {
    console.error("[Style Templates GET] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to load templates" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  // Admin-only template creation check
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { role: true },
  });
  if (user?.role?.key !== "admin") {
    return NextResponse.json({ error: "Forbidden: Admin access required to register templates" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { key, name, engine, paramSchema, thumbnail } = body;
    if (!key || !name || !engine || !paramSchema) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const template = await createStyleTemplate({
      key,
      name,
      engine,
      paramSchema: typeof paramSchema === "string" ? paramSchema : JSON.stringify(paramSchema),
      thumbnail,
      createdBy: session.userId,
    });
    return NextResponse.json(template, { status: 201 });
  } catch (err: any) {
    console.error("[Style Templates POST] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to create template" }, { status: 500 });
  }
}
