export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

/**
 * GET /api/managed/clip-mixer/debug
 * 
 * Full diagnostic for lyrical overlay rendering pipeline.
 * 
 * Query params:
 *   ?templateId=xxx        — Inspect by template ID
 *   ?templateName=xxx      — Inspect by template name (first match)
 *   ?testRender=true       — Also generate a 3-second test render
 *   ?forceReRender=true    — Delete cached overlay and re-render with VP9
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const templateId = searchParams.get("templateId");
  const templateName = searchParams.get("templateName");
  const testRender = searchParams.get("testRender") === "true";
  const forceReRender = searchParams.get("forceReRender") === "true";

  const diag: Record<string, any> = {
    timestamp: new Date().toISOString(),
    stage: "starting",
  };

  try {
    // ── 1. Find the template ────────────────────────────────────────────
    let template: any = null;
    if (templateId) {
      template = await prisma.trackLyricalTemplate.findUnique({
        where: { id: templateId },
        include: { track: true },
      });
    } else if (templateName) {
      template = await prisma.trackLyricalTemplate.findFirst({
        where: { templateName: { contains: templateName, mode: "insensitive" } },
        include: { track: true },
      });
    }

    if (!template) {
      // List all templates for reference
      const allTemplates = await prisma.trackLyricalTemplate.findMany({
        select: { id: true, templateName: true, trackId: true, bgColor: true, animationMode: true },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
      return NextResponse.json({
        error: "Template not found. Pass ?templateId=xxx or ?templateName=xxx",
        availableTemplates: allTemplates,
      }, { status: 404 });
    }

    // ── 2. Template DB values ───────────────────────────────────────────
    diag.stage = "template_values";
    diag.template = {
      id: template.id,
      templateName: template.templateName,
      trackId: template.trackId,
      trackTitle: template.track?.title,
      trackDuration: template.track?.duration,
      hasTranscription: !!template.track?.lyricalTranscription,
      transcriptionWordCount: template.track?.lyricalTranscription
        ? JSON.parse(template.track.lyricalTranscription).length
        : 0,

      // Visual config
      fontFamily: template.fontFamily,
      fontSize: template.fontSize,
      activeColor: template.activeColor,
      textColor: template.textColor,
      strokeWidth: template.strokeWidth,
      strokeColor: template.strokeColor,
      positionY: template.positionY,
      animationMode: template.animationMode,
      textAlign: template.textAlign,
      wordSpacing: template.wordSpacing,
      letterSpacing: template.letterSpacing,

      // Background config
      bgColor: template.bgColor,
      colorFilter: template.colorFilter,
      vignette: template.vignette,
      particleFx: template.particleFx,
      mirrorBg: template.mirrorBg,
      bgSpeed: template.bgSpeed,
      muteAudio: template.muteAudio,

      // File URLs
      overlayVideoUrl: template.overlayVideoUrl,
      previewImageUrl: template.previewImageUrl,
    };

    // ── 3. Transparency analysis ────────────────────────────────────────
    const hasSolidBg = !!template.bgColor &&
      template.bgColor !== "none" &&
      template.bgColor !== "transparent" &&
      template.bgColor !== "null";

    diag.transparencyAnalysis = {
      bgColorValue: template.bgColor,
      hasSolidBg,
      needsAlpha: !hasSolidBg,
      expectedCodec: hasSolidBg ? "VP8 (libvpx)" : "VP9 (libvpx-vp9)",
      expectedPixFmt: hasSolidBg ? "yuv420p" : "yuva420p (with alpha)",
      verdict: hasSolidBg
        ? "Template has solid bg color — overlay IS the full video, no transparency needed"
        : "Template has NO bg color — overlay MUST have alpha transparency for lyrics to show over video",
    };

    // ── 4. Overlay file analysis ────────────────────────────────────────
    diag.stage = "overlay_file";
    let overlayUrl = template.overlayVideoUrl;
    if (!overlayUrl) {
      const sanitizedName = template.templateName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
      overlayUrl = `/uploads/lyrical/overlays/track_${template.trackId}_${sanitizedName}.webm`;
    }
    const overlayPath = path.join(process.cwd(), "public", overlayUrl);
    const overlayReadyPath = overlayPath + ".ready";

    diag.overlayFile = {
      expectedUrl: overlayUrl,
      absolutePath: overlayPath,
      exists: fs.existsSync(overlayPath),
      readySentinel: fs.existsSync(overlayReadyPath),
      readySentinelContent: null as string | null,
      sizeBytes: 0,
      sizeKB: "0",
      isValidSize: false,
    };

    if (fs.existsSync(overlayReadyPath)) {
      try {
        diag.overlayFile.readySentinelContent = fs.readFileSync(overlayReadyPath, "utf-8").trim();
      } catch {}
    }

    if (fs.existsSync(overlayPath)) {
      const stat = fs.statSync(overlayPath);
      diag.overlayFile.sizeBytes = stat.size;
      diag.overlayFile.sizeKB = (stat.size / 1024).toFixed(1);
      diag.overlayFile.isValidSize = stat.size > 1024;
      diag.overlayFile.lastModified = stat.mtime.toISOString();
    }

    // ── 5. FFprobe overlay codec analysis ───────────────────────────────
    diag.stage = "ffprobe";
    diag.ffprobe = { available: false } as Record<string, any>;

    if (fs.existsSync(overlayPath)) {
      try {
        // Get codec info
        const codecInfo = execSync(
          `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,pix_fmt,width,height,duration,nb_frames -of json "${overlayPath}"`,
          { timeout: 15000 }
        ).toString().trim();
        const parsed = JSON.parse(codecInfo);
        const stream = parsed?.streams?.[0] || {};

        diag.ffprobe = {
          available: true,
          codec: stream.codec_name || "unknown",
          pixFmt: stream.pix_fmt || "unknown",
          width: stream.width,
          height: stream.height,
          duration: stream.duration,
          nbFrames: stream.nb_frames,
          hasAlphaPixFmt: (stream.pix_fmt || "").includes("a"), // yuva420p has 'a'
        };

        // Check if alpha is actually present
        const isVP8 = stream.codec_name === "vp8";
        const isVP9 = stream.codec_name === "vp9";
        const hasAlphaFmt = (stream.pix_fmt || "").includes("a");

        diag.ffprobe.diagnosis = [];
        if (isVP8 && !hasSolidBg) {
          diag.ffprobe.diagnosis.push("❌ CRITICAL: VP8 codec detected but template needs transparency. VP8 does NOT support alpha channel!");
          diag.ffprobe.diagnosis.push("→ This overlay has an opaque black background instead of transparent.");
          diag.ffprobe.diagnosis.push("→ Fix: Re-render with VP9 (libvpx-vp9) which supports yuva420p alpha.");
        }
        if (isVP9 && hasAlphaFmt && !hasSolidBg) {
          diag.ffprobe.diagnosis.push("✅ VP9 with alpha pixel format — overlay should be transparent.");
        }
        if (isVP9 && !hasAlphaFmt && !hasSolidBg) {
          diag.ffprobe.diagnosis.push("⚠️ VP9 detected but pixel format lacks alpha. Overlay may not be transparent.");
        }
        if (hasSolidBg) {
          diag.ffprobe.diagnosis.push("ℹ️ Template has solid bg — transparency not needed. Any codec works.");
        }

      } catch (probeErr: any) {
        diag.ffprobe = {
          available: false,
          error: probeErr.message || String(probeErr),
          stderr: probeErr.stderr?.toString().slice(0, 500),
        };
      }
    } else {
      diag.ffprobe.note = "Overlay file does not exist — nothing to probe.";
    }

    // ── 6. FFmpeg version check ─────────────────────────────────────────
    diag.stage = "ffmpeg_version";
    try {
      const versionOut = execSync("ffmpeg -version 2>&1 | head -3", { timeout: 5000 }).toString().trim();
      diag.ffmpegVersion = versionOut;
    } catch {
      diag.ffmpegVersion = "Could not determine FFmpeg version";
    }

    // Check VP9 encoder availability
    try {
      const codecs = execSync("ffmpeg -codecs 2>&1 | grep vpx", { timeout: 5000 }).toString().trim();
      diag.vpxCodecs = codecs;
    } catch {
      diag.vpxCodecs = "Could not check VPX codecs";
    }

    // Check ass filter availability
    try {
      const filters = execSync("ffmpeg -filters 2>&1 | grep -i ass", { timeout: 5000 }).toString().trim();
      diag.assFilter = filters || "ass filter NOT found";
    } catch {
      diag.assFilter = "Could not check filters";
    }

    // ── 7. Force re-render ──────────────────────────────────────────────
    if (forceReRender) {
      diag.stage = "force_re_render";
      try {
        // Delete existing overlay + sentinel
        if (fs.existsSync(overlayPath)) fs.unlinkSync(overlayPath);
        if (fs.existsSync(overlayReadyPath)) fs.unlinkSync(overlayReadyPath);

        if (!template.track.lyricalTranscription) {
          diag.reRender = { error: "Track has no Whisper transcription data" };
        } else {
          const words = JSON.parse(template.track.lyricalTranscription);
          const duration = template.track.duration || 10.0;
          const rendererConfig = {
            fontFamily: template.fontFamily,
            fontSize: template.fontSize,
            activeColor: template.activeColor,
            strokeWidth: template.strokeWidth,
            strokeColor: template.strokeColor,
            positionY: template.positionY,
            colorFilter: template.colorFilter,
            vignette: template.vignette,
            particleFx: template.particleFx,
            animationMode: template.animationMode as "highlight" | "word_builder",
            bgColor: template.bgColor,
            textColor: template.textColor,
            textAlign: template.textAlign,
            wordSpacing: template.wordSpacing,
            letterSpacing: template.letterSpacing,
          };

          const { renderCanvasOverlay } = await import("@/lib/ffmpeg-overlay-renderer");
          await renderCanvasOverlay(words, rendererConfig, duration, overlayPath);

          // Re-probe the newly generated file
          diag.reRender = { success: true, message: "Overlay re-rendered successfully" };
          if (fs.existsSync(overlayPath)) {
            const stat = fs.statSync(overlayPath);
            diag.reRender.newSizeBytes = stat.size;
            diag.reRender.newSizeKB = (stat.size / 1024).toFixed(1);
            try {
              const codecInfo = execSync(
                `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,pix_fmt -of csv=p=0 "${overlayPath}"`,
                { timeout: 15000 }
              ).toString().trim();
              diag.reRender.newCodecInfo = codecInfo;
              const [codec, pixFmt] = codecInfo.split(",");
              diag.reRender.newCodec = codec;
              diag.reRender.newPixFmt = pixFmt;
              diag.reRender.hasAlpha = (pixFmt || "").includes("a");
            } catch {}
          }
        }
      } catch (err: any) {
        diag.reRender = {
          error: err.message || String(err),
          stack: err.stack?.split("\n").slice(0, 5),
        };
      }
    }

    // ── 8. Test render (mini 3-second clip composite) ────────────────────
    if (testRender && fs.existsSync(overlayPath)) {
      diag.stage = "test_render";
      try {
        const testDir = path.join(process.cwd(), "public", "uploads", "debug");
        fs.mkdirSync(testDir, { recursive: true });
        const testOutputPath = path.join(testDir, `test_${template.id}.mp4`);

        // Create a simple color background + overlay composite
        const testCmd = [
          `ffmpeg -y`,
          `-f lavfi -i "color=c=blue:s=720x1280:d=3:r=30"`,
          `-i "${overlayPath}"`,
          `-filter_complex "[0:v][1:v]overlay=0:0:shortest=1:format=auto[v]"`,
          `-map "[v]"`,
          `-c:v libx264`,
          `-pix_fmt yuv420p`,
          `-preset ultrafast`,
          `-t 3`,
          `"${testOutputPath}"`,
        ].join(" ");

        diag.testRender = {
          command: testCmd,
          status: "running",
        };

        const result = execSync(testCmd, { timeout: 30000, encoding: "utf-8" });
        
        if (fs.existsSync(testOutputPath)) {
          const stat = fs.statSync(testOutputPath);
          diag.testRender.status = "success";
          diag.testRender.outputSizeKB = (stat.size / 1024).toFixed(1);
          diag.testRender.outputUrl = `/uploads/debug/test_${template.id}.mp4`;
          diag.testRender.note = "Download this test video from your browser to check if lyrics are visible over a blue background.";
        } else {
          diag.testRender.status = "failed";
          diag.testRender.note = "Output file not created";
        }
      } catch (testErr: any) {
        diag.testRender = {
          status: "failed",
          error: testErr.message || String(testErr),
          stderr: testErr.stderr?.toString().slice(0, 1000),
        };
      }
    }

    // ── 9. Summary verdict ──────────────────────────────────────────────
    diag.stage = "complete";
    const issues: string[] = [];

    if (!diag.overlayFile.exists) {
      issues.push("Overlay WebM file does not exist on disk");
    }
    if (!diag.overlayFile.readySentinel) {
      issues.push("Overlay .ready sentinel file is missing");
    }
    if (diag.overlayFile.exists && !diag.overlayFile.isValidSize) {
      issues.push(`Overlay file too small: ${diag.overlayFile.sizeBytes} bytes`);
    }
    if (diag.ffprobe?.codec === "vp8" && !hasSolidBg) {
      issues.push("CRITICAL: Overlay uses VP8 which has NO alpha support — lyrics will have opaque black bg");
    }
    if (diag.ffprobe?.codec === "vp9" && !diag.ffprobe?.hasAlphaPixFmt && !hasSolidBg) {
      issues.push("Overlay uses VP9 but pixel format lacks alpha channel");
    }
    if (!template.track?.lyricalTranscription) {
      issues.push("Track has no Whisper alignment/transcription data");
    }

    diag.verdict = {
      issueCount: issues.length,
      issues,
      recommendation: issues.length === 0
        ? "No issues detected. Try ?testRender=true to generate a test composite."
        : issues.some(i => i.includes("VP8"))
          ? "Use ?forceReRender=true to re-render the overlay with VP9 alpha support."
          : "Review the issues above.",
    };

    return NextResponse.json(diag, { status: 200 });
  } catch (err: any) {
    diag.error = err.message || String(err);
    diag.stack = err.stack?.split("\n").slice(0, 8);
    return NextResponse.json(diag, { status: 500 });
  }
}
