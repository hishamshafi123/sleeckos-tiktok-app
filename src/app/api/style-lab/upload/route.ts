export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";

const ALLOWED_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * POST /api/style-lab/upload (multipart form) — image upload for Style Lab
 * image layers.
 * Field: file (png/jpg/jpeg/webp, ≤ 8MB).
 * Stores to public/uploads/style-lab/layer_<uuid>.<ext> (local only — the
 * Remotion renderer reads it via staticFile from public/) and returns
 * { url }.
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
    if (!ALLOWED_EXT.has(ext)) {
      return NextResponse.json(
        { error: `Unsupported image type "${ext || "?"}" — use png, jpg or webp` },
        { status: 400 },
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length === 0) {
      return NextResponse.json({ error: "Empty file" }, { status: 400 });
    }
    if (buf.length > MAX_BYTES) {
      return NextResponse.json({ error: "Image too large (max 8MB)" }, { status: 400 });
    }

    const uploadDir = path.join(process.cwd(), "public", "uploads", "style-lab");
    fs.mkdirSync(uploadDir, { recursive: true });
    const fileName = `layer_${randomUUID()}${ext}`;
    fs.writeFileSync(path.join(uploadDir, fileName), buf);

    return NextResponse.json({ url: `/uploads/style-lab/${fileName}` }, { status: 201 });
  } catch (err: any) {
    console.error("[Style Lab Upload] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to upload image" }, { status: 500 });
  }
}
