export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { submitCuratorClip, getCuratorSubmissions } from "@/lib/services/projects";
import prisma from "@/lib/db";
import fs from "fs";
import path from "path";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "projects"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const status = req.nextUrl.searchParams.get("status") || undefined;

  try {
    const submissions = await getCuratorSubmissions(session.userId, status);
    return NextResponse.json(submissions);
  } catch (err: any) {
    console.error("[Submissions GET] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to load submissions" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "projects"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const contentType = req.headers.get("content-type") || "";

    // Paste Link/URL or custom JSON reference
    if (contentType.includes("application/json")) {
      const body = await req.json();
      const { campaignId, folderId, clipRef } = body;

      if (!campaignId || !clipRef) {
        return NextResponse.json({ error: "Missing campaignId or clipRef" }, { status: 400 });
      }

      const submission = await submitCuratorClip(
        session.userId,
        campaignId,
        folderId || null,
        clipRef.trim()
      );

      return NextResponse.json(submission, { status: 201 });
    }

    // Direct File Upload
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const campaignId = formData.get("campaignId") as string;
      const folderId = formData.get("folderId") as string;
      const file = formData.get("clipFile") as File;

      if (!campaignId) {
        return NextResponse.json({ error: "Missing campaignId" }, { status: 400 });
      }
      if (!file) {
        return NextResponse.json({ error: "No video file provided" }, { status: 400 });
      }

      const uploadDir = path.join(process.cwd(), "public", "uploads", "curator", campaignId);
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const fileExt = path.extname(file.name) || ".mp4";
      const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}${fileExt}`;
      const filePath = path.join(uploadDir, fileName);

      const buffer = Buffer.from(await file.arrayBuffer());
      fs.writeFileSync(filePath, buffer);

      const relativeUrl = `/uploads/curator/${campaignId}/${fileName}`;

      const submission = await submitCuratorClip(
        session.userId,
        campaignId,
        folderId || null,
        relativeUrl
      );

      return NextResponse.json(submission, { status: 201 });
    }

    return NextResponse.json({ error: "Unsupported content type" }, { status: 400 });
  } catch (err: any) {
    console.error("[Submissions POST] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to submit clip" }, { status: 500 });
  }
}
