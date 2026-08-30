export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import path from "path";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { FontInstallError, registerUploadedFont } from "@/lib/services/custom-fonts";

/**
 * POST /api/style-lab/fonts/upload (multipart form) — install a custom TTF.
 * Fields:
 *   file   (required) — .ttf/.otf, ≤ 5MB
 *   family (optional) — display family name; falls back to the file name
 *   weight (optional) — 100–900, default 400
 * Stores to public/fonts/custom/<slug>/, upserts the FontAsset row
 * (source "custom"), mirrors to R2, and returns the manifest entry.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "style_studio"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "file is required" }, { status: 400 });

    const ext = path.extname(file.name || "").toLowerCase();
    if (ext !== ".ttf" && ext !== ".otf") {
      return NextResponse.json(
        { error: `Unsupported font type "${ext || "?"}" — upload a static .ttf` },
        { status: 400 },
      );
    }

    const familyField = formData.get("family");
    const family =
      (typeof familyField === "string" && familyField.trim()) ||
      path.basename(file.name || "", ext).replace(/[-_]+/g, " ").trim();
    if (!family) {
      return NextResponse.json({ error: "family is required" }, { status: 400 });
    }

    const weightField = formData.get("weight");
    const weight = weightField ? Number(weightField) : 400;
    if (!Number.isInteger(weight) || weight < 100 || weight > 900 || weight % 100 !== 0) {
      return NextResponse.json(
        { error: "weight must be a multiple of 100 between 100 and 900" },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const entry = await registerUploadedFont(buffer, family, weight);
    return NextResponse.json(entry, { status: 201 });
  } catch (err: any) {
    if (err instanceof FontInstallError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[Style Lab Font Upload] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to upload font" }, { status: 500 });
  }
}
