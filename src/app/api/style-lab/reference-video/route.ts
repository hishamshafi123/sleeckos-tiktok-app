export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import os from "os";
import path from "path";
import fs from "fs";
import { getSession } from "@/lib/session";
import {
  generateDraftFromReferenceVideo,
  probeDurationSeconds,
} from "@/lib/services/style-match";
import type { StyleFamily } from "@/lib/style-lab/schema";

export const maxDuration = 300;

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_DURATION_SECONDS = 120;
const ALLOWED_EXTS = new Set([".mp4", ".mov", ".webm"]);

/**
 * POST /api/style-lab/reference-video (multipart form) — ADMIN ONLY.
 * Fields:
 *   file          (required) — .mp4/.mov/.webm, ≤ 50MB, ≤ 120s
 *   family        (optional) — "lyric" (default) | "quote"
 *   referenceName (optional) — display hint for the style name
 * Gemini watches the clip and recreates its caption style as a Style Lab AI
 * draft (auto-installing the identified Google Font when possible). Returns
 * the decorated draft row — it lands on the Drafts shelf like describe-mode
 * drafts. The uploaded reference is deleted once the draft is generated.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  let tmpPath: string | null = null;
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "file is required" }, { status: 400 });

    const ext = path.extname(file.name || "").toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) {
      return NextResponse.json(
        { error: `Unsupported video type "${ext || "?"}" — upload .mp4, .mov or .webm` },
        { status: 400 },
      );
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "Reference video is too large (max 50MB)" }, { status: 400 });
    }

    const fam: StyleFamily = formData.get("family") === "quote" ? "quote" : "lyric";
    const refField = formData.get("referenceName");
    const referenceName =
      typeof refField === "string" && refField.trim() ? refField.trim().slice(0, 80) : undefined;

    tmpPath = path.join(
      os.tmpdir(),
      `style-match-ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`,
    );
    fs.writeFileSync(tmpPath, Buffer.from(await file.arrayBuffer()));

    const duration = await probeDurationSeconds(tmpPath);
    if (duration > MAX_DURATION_SECONDS) {
      return NextResponse.json(
        { error: `Reference video is ${Math.round(duration)}s — keep it under ${MAX_DURATION_SECONDS}s` },
        { status: 400 },
      );
    }

    const draft = await generateDraftFromReferenceVideo({
      videoPath: tmpPath,
      family: fam,
      ...(referenceName ? { referenceName } : {}),
      createdBy: session.userId,
    });
    return NextResponse.json(draft, { status: 201 });
  } catch (err: unknown) {
    console.error("[Style Lab Reference Video] Error:", err);
    const msg = err instanceof Error ? err.message : "Style Match failed";
    const status = /GEMINI_API_KEY|required|validation|parseable|probe/i.test(msg) ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  } finally {
    if (tmpPath) fs.rmSync(tmpPath, { force: true });
  }
}
