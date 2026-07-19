export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import fs from "fs";
import path from "path";
import { getR2SignedUrl, downloadFromR2 } from "@/lib/services/storage";

// GET /api/managed/multiplier/preview?outputId=...
// Returns a URL for the modal player to stream the rendered video

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const outputId = searchParams.get("outputId");

  if (!outputId) {
    return NextResponse.json({ error: "Missing outputId" }, { status: 400 });
  }

  try {
    const output = await prisma.multiplierOutput.findUnique({
      where: { id: outputId },
      select: {
        id: true,
        status: true,
        outputRef: true,
      },
    });

    if (!output) {
      return NextResponse.json({ error: "Output not found" }, { status: 404 });
    }

    if (output.status !== "COMPLETED") {
      return NextResponse.json(
        { error: output.status === "RENDERING" ? "Video is still rendering..." : "Video is not available" },
        { status: 400 }
      );
    }

    if (!output.outputRef) {
      return NextResponse.json({ error: "No rendered video file associated with this output" }, { status: 400 });
    }

    // Check if file exists locally
    const publicDir = path.join(process.cwd(), "public");
    const localPath = path.join(publicDir, output.outputRef);

    if (fs.existsSync(localPath)) {
      // File exists locally — serve via range serve route
      const serveUrl = output.outputRef.startsWith("/uploads/")
        ? output.outputRef.replace("/uploads/", "/api/uploads/")
        : output.outputRef;
      return NextResponse.json({
        url: serveUrl,
        status: "local",
      });
    }

    // Try to get a signed URL from R2
    const r2Key = `uploads/multiplier/renders/multi_${output.id}.mp4`;
    const signedUrl = await getR2SignedUrl(r2Key, 3600);

    if (signedUrl) {
      return NextResponse.json({
        url: signedUrl,
        status: "r2",
      });
    }

    // Try downloading from R2 to local
    const downloaded = await downloadFromR2(r2Key, localPath);
    if (downloaded && fs.existsSync(localPath)) {
      const serveUrl = output.outputRef.startsWith("/uploads/")
        ? output.outputRef.replace("/uploads/", "/api/uploads/")
        : output.outputRef;
      return NextResponse.json({
        url: serveUrl,
        status: "downloaded",
      });
    }

    return NextResponse.json({ error: "Video file unavailable — not found locally or on R2" }, { status: 404 });
  } catch (err: any) {
    console.error("[Multiplier Preview] Error:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
