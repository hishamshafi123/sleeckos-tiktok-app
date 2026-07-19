import prisma from "@/lib/db";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { uploadToR2, downloadFromR2 } from "./storage";

const execAsync = promisify(exec);

export interface RecipeSlice {
  clipId: string;
  start: number;
  duration: number;
}

export interface VideoRecipe {
  clipSlices: RecipeSlice[];
  trackId: string;
  trackStart: number;
  muteAudio: boolean;
  templateId: string;
}

/**
 * Generates a deterministic SHA-256 fingerprint for a video recipe
 */
export function calculateRecipeFingerprint(recipe: VideoRecipe): string {
  const serialized = JSON.stringify({
    slices: recipe.clipSlices.map(s => ({
      clipId: s.clipId,
      start: Math.round(s.start * 10) / 10,      // round to 1 decimal place to ignore float variance
      duration: Math.round(s.duration * 10) / 10,
    })),
    trackId: recipe.trackId,
    trackStart: Math.round(recipe.trackStart * 10) / 10,
    muteAudio: recipe.muteAudio,
    templateId: recipe.templateId,
  });
  return createHash("sha256").update(serialized).digest("hex");
}

/**
 * Generates N unique video recipes from a subfolder, constrained by variation strength
 */
export async function generateRecipesForBatch(opts: {
  folderId: string;
  count: number;
  targetDuration: number;
  variationStrength: number; // 1 to 5
  trackId: string;
  templateId: string;
  trackStart: number;
  muteAudio: boolean;
}) {
  const {
    folderId,
    count,
    targetDuration,
    variationStrength,
    trackId,
    templateId,
    trackStart,
    muteAudio,
  } = opts;

  const folder = await prisma.clipFolder.findUnique({
    where: { id: folderId },
    include: { clips: true },
  });

  if (!folder || folder.clips.length === 0) {
    throw new Error("Folder not found or has no source clips uploaded");
  }

  const clips = [...folder.clips];
  const track = await prisma.track.findUnique({ where: { id: trackId } });
  if (!track) throw new Error("Track not found");

  const recipes: VideoRecipe[] = [];
  const usedFingerprints = new Set<string>();

  // Determine mixing parameters based on variationStrength (1 to 5)
  // Strength 1: No shuffling, minimal trim variance (always starts at 0 or same offset)
  // Strength 2: Minimal shuffling, trim variance +/- 0.5s
  // Strength 3 (Default): Standard random shuffling, trim variance +/- 2.0s
  // Strength 4: High shuffling, trim variance fully randomized, variable slice durations (2.5s - 5.5s)
  // Strength 5: Extreme shuffling, slice count variations, fully randomized trims, and slice durations (2.0s - 6.0s)
  
  for (let i = 0; i < count; i++) {
    let recipe: VideoRecipe | null = null;
    let attempts = 0;
    
    while (attempts < 100) {
      const slices: RecipeSlice[] = [];
      let currentDuration = 0;

      // Compute target duration with strength-controlled variance
      let T = targetDuration;
      if (variationStrength >= 3) {
        const varMax = variationStrength === 3 ? 2 : variationStrength === 4 ? 4 : 6;
        const variance = Math.random() * (varMax * 2) - varMax;
        T += variance;
      }
      T = Math.min(T, track.duration);
      if (T < 5.0) T = 5.0;

      // Shuffle clips list based on strength
      let sourceClips = [...clips];
      if (variationStrength >= 2) {
        // Shuffle clips randomly
        sourceClips = sourceClips.sort(() => Math.random() - 0.5);
      } else {
        // Deterministic cycle: rotate clips array by index offset
        const rotateOffset = i % sourceClips.length;
        sourceClips = [...sourceClips.slice(rotateOffset), ...sourceClips.slice(0, rotateOffset)];
      }

      for (const clip of sourceClips) {
        if (currentDuration >= T) break;

        const remaining = T - currentDuration;

        // Determine slice duration based on strength
        let sliceDuration = 4.0;
        if (variationStrength >= 4) {
          const minDur = variationStrength === 4 ? 2.5 : 2.0;
          const maxDur = variationStrength === 4 ? 5.5 : 6.0;
          sliceDuration = Math.random() * (maxDur - minDur) + minDur;
        } else if (variationStrength === 3) {
          sliceDuration = Math.random() * 2.0 + 3.0; // 3.0s to 5.0s
        } else if (variationStrength === 2) {
          sliceDuration = 4.0 + (Math.random() * 1.0 - 0.5); // 3.5s to 4.5s
        }

        if (sliceDuration > clip.duration) {
          sliceDuration = clip.duration;
        }
        if (sliceDuration > remaining) {
          sliceDuration = remaining;
        }

        // Handle last slice safety padding
        if (remaining <= 5.0) {
          if (clip.duration >= remaining) {
            sliceDuration = remaining;
          } else {
            sliceDuration = clip.duration;
          }
        }

        // Determine slice trim start point based on strength
        let start = 0;
        const maxStart = Math.max(0, clip.duration - sliceDuration);
        if (maxStart > 0) {
          if (variationStrength >= 3) {
            start = Math.random() * maxStart;
          } else if (variationStrength === 2) {
            // Pick from 3 distinct segments: start, middle, or end
            const segment = Math.floor(Math.random() * 3);
            start = (segment / 2) * maxStart;
          } else {
            // Always trim starting at 0
            start = 0;
          }
        }

        slices.push({
          clipId: clip.id,
          start,
          duration: sliceDuration,
        });

        currentDuration += sliceDuration;
      }

      recipe = {
        clipSlices: slices,
        trackId,
        trackStart,
        muteAudio,
        templateId,
      };

      const fingerprint = calculateRecipeFingerprint(recipe);
      if (!usedFingerprints.has(fingerprint)) {
        usedFingerprints.add(fingerprint);
        recipes.push(recipe);
        break;
      }

      attempts++;
    }

    if (attempts >= 100) {
      throw new Error(
        `Folder is too small to yield ${count} unique recipes without duplicates. Try uploading more clips, reducing the count, or increasing the variation strength.`
      );
    }
  }

  return recipes;
}

/**
 * Render a single ClipMixerItem using its saved recipe configuration
 */
export async function renderMix(itemId: string) {
  const item = await prisma.clipMixerItem.findUnique({
    where: { id: itemId },
    include: {
      batch: {
        include: {
          track: true,
        },
      },
    },
  });

  if (!item) throw new Error(`Item ${itemId} not found`);
  if (!item.recipeJson) throw new Error(`Item ${itemId} has no recipe configuration JSON`);

  const recipe = JSON.parse(item.recipeJson) as VideoRecipe;
  const templateId = recipe.templateId || item.lyricalTemplateId || item.batch.lyricalTemplateId;

  const template = await prisma.trackLyricalTemplate.findUnique({
    where: { id: templateId },
  });

  if (!template) {
    throw new Error(`Lyrics template styling preset not found for item ${itemId}`);
  }

  const duration = recipe.clipSlices.reduce((sum, s) => sum + s.duration, 0);
  const width = template.aspectRatio === "1:1" ? 720 : 720;
  const height = template.aspectRatio === "1:1" ? 720 : 1280;

  const rendersDir = path.join(process.cwd(), "public", "uploads", "clip-mixer-renders");
  if (!fs.existsSync(rendersDir)) {
    fs.mkdirSync(rendersDir, { recursive: true });
  }
  const localOutFile = path.join(rendersDir, `render_${itemId}.mp4`);

  // Build inputs
  const inputs: string[] = [];
  for (const slice of recipe.clipSlices) {
    const clip = await prisma.clipVideo.findUnique({ where: { id: slice.clipId } });
    if (!clip) throw new Error(`Source clip ${slice.clipId} missing from database`);
    const clipPath = path.join(process.cwd(), "public", clip.videoUrl);
    if (!fs.existsSync(clipPath)) throw new Error(`Clip file missing from disk: ${clipPath}`);
    inputs.push(`-ss ${slice.start.toFixed(3)} -t ${slice.duration.toFixed(3)} -i "${clipPath}"`);
  }

  const bgOpacity = typeof template.bgOpacity === "number" ? template.bgOpacity : 1.0;
  const templateHasSolidBg = !!template.bgColor &&
    template.bgColor !== "none" &&
    template.bgColor !== "transparent" &&
    template.bgColor !== "null" &&
    bgOpacity >= 0.99;

  // Solid BG Rendering vs Transparent ASS Subtitle Burning
  if (templateHasSolidBg) {
    let overlayUrl = template.overlayVideoUrl;
    if (!overlayUrl) {
      const sanitizedName = template.templateName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
      overlayUrl = `/uploads/lyrical/overlays/track_${template.trackId}_${sanitizedName}.webm`;
    }
    const overlayPath = path.join(process.cwd(), "public", overlayUrl);
    if (!fs.existsSync(overlayPath)) throw new Error(`Pre-rendered overlay file missing for solid bg: ${overlayPath}`);

    const audioPath = path.join(process.cwd(), "public", item.batch.track.fileUrl);
    const ssOpt = recipe.trackStart > 0 ? `-ss ${recipe.trackStart.toFixed(3)}` : "";
    const finalAudioInput = recipe.muteAudio
      ? `-f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100`
      : `${ssOpt} -i "${audioPath}"`;

    const cmd = [
      `ffmpeg -y`,
      recipe.trackStart > 0 ? `-ss ${recipe.trackStart.toFixed(3)} -i "${overlayPath}"` : `-i "${overlayPath}"`,
      finalAudioInput,
      `-c:v libx264`,
      `-preset medium`,
      `-crf 26`,
      `-maxrate 8M`,
      `-bufsize 16M`,
      `-r 30`,
      `-pix_fmt yuv420p`,
      `-c:a aac -b:a 128k`,
      `-movflags +faststart`,
      `-t ${duration.toFixed(3)}`,
      `"${localOutFile}"`,
    ].join(" ");

    await execAsync(cmd, { timeout: 300000 });
  } else {
    // Direct ASS Subtitle Burn
    if (!item.batch.track.lyricalTranscription) {
      throw new Error(`Track "${item.batch.track.title}" has no Whisper alignment data.`);
    }

    const { generateASS } = await import("../ffmpeg-overlay-renderer");
    const words = JSON.parse(item.batch.track.lyricalTranscription);

    // Shift timings
    const shiftedWords = words
      .map((w: any) => {
        const start = Math.max(0, w.start - recipe.trackStart);
        const end = w.end - recipe.trackStart;
        return { ...w, start, end };
      })
      .filter((w: any) => w.end > 0);

    const assContent = generateASS(shiftedWords, {
      fontFamily: template.fontFamily,
      fontSize: template.fontSize,
      activeColor: template.activeColor,
      strokeWidth: template.strokeWidth,
      strokeColor: template.strokeColor,
      positionY: template.positionY,
      colorFilter: template.colorFilter,
      vignette: template.vignette,
      particleFx: template.particleFx,
      animationMode: template.animationMode as "highlight" | "word_builder" | "brat",
      bgColor: template.bgColor,
      textColor: template.textColor,
      textAlign: template.textAlign,
      wordSpacing: template.wordSpacing,
      letterSpacing: template.letterSpacing,
      aspectRatio: template.aspectRatio,
      bgOpacity: template.bgOpacity,
      lofiFactor: template.lofiFactor,
      textMargin: template.textMargin,
    });

    const assPath = `/tmp/clip_mixer_${itemId}.ass`;
    fs.writeFileSync(assPath, assContent, "utf-8");

    const audioPath = path.join(process.cwd(), "public", item.batch.track.fileUrl);
    if (recipe.muteAudio) {
      inputs.push(`-f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100`);
    } else {
      if (recipe.trackStart > 0) {
        inputs.push(`-ss ${recipe.trackStart.toFixed(3)} -i "${audioPath}"`);
      } else {
        inputs.push(`-i "${audioPath}"`);
      }
    }
    const audioIdx = recipe.clipSlices.length;

    // Filter complex builder
    let filterComplex = "";
    for (let i = 0; i < recipe.clipSlices.length; i++) {
      filterComplex += `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=30,format=yuv420p[v${i}];`;
    }

    let lastVideoLabel = "";
    if (recipe.clipSlices.length > 1) {
      for (let i = 0; i < recipe.clipSlices.length; i++) {
        filterComplex += `[v${i}]`;
      }
      filterComplex += `concat=n=${recipe.clipSlices.length}:v=1:a=0[v_concated];`;
      lastVideoLabel = "v_concated";
    } else {
      lastVideoLabel = "v0";
    }

    let finalVideoInputLabel = lastVideoLabel;
    if (!!template.bgColor && template.bgColor !== "none" && template.bgColor !== "transparent" && bgOpacity > 0) {
      const colorHex = template.bgColor.startsWith("#") ? template.bgColor.slice(1) : template.bgColor;
      const formattedColor = colorHex.startsWith("0x") ? colorHex : "0x" + colorHex;
      filterComplex += `color=c=${formattedColor}@${bgOpacity}:s=${width}x${height}:d=${duration.toFixed(3)}:r=30[color_overlay];[${lastVideoLabel}][color_overlay]overlay=shortest=1[colored_bg];`;
      finalVideoInputLabel = "colored_bg";
    }

    const fontsDir = path.join(process.cwd(), "public", "fonts");
    const escapedAss = assPath.replace(/\\/g, "/").replace(/:/g, "\\\\:");
    const lofiFactor = template.lofiFactor ?? 1;

    if (lofiFactor > 1) {
      filterComplex += `[${finalVideoInputLabel}]ass='${escapedAss}':fontsdir='${fontsDir}'[v_before_lofi];`;
      filterComplex += `[v_before_lofi]scale=w=iw/${lofiFactor}:h=ih/${lofiFactor},scale=w=iw:h=ih:flags=neighbor[v_final]`;
    } else {
      filterComplex += `[${finalVideoInputLabel}]ass='${escapedAss}':fontsdir='${fontsDir}'[v_final]`;
    }

    const cmd = [
      `ffmpeg -y`,
      ...inputs,
      `-filter_complex "${filterComplex}"`,
      `-map "[v_final]"`,
      `-map ${audioIdx}:a`,
      `-c:v libx264`,
      `-preset medium`,
      `-crf 26`,
      `-maxrate 8M`,
      `-bufsize 16M`,
      `-r 30`,
      `-pix_fmt yuv420p`,
      `-c:a aac -b:a 128k`,
      `-movflags +faststart`,
      `-t ${duration.toFixed(3)}`,
      `"${localOutFile}"`,
    ].join(" ");

    try {
      await execAsync(cmd, { timeout: 300000 });
    } finally {
      try { fs.unlinkSync(assPath); } catch {}
    }
  }

  // Upload completed video to Cloudflare R2
  const r2Key = `uploads/clip-mixer-renders/render_${itemId}.mp4`;
  await uploadToR2(localOutFile, r2Key);

  // Return the public relative URL
  return `/uploads/clip-mixer-renders/render_${itemId}.mp4`;
}

/**
 * Bundles a batch rendering output into structured Account_X directories, tars, zips, and saves to R2.
 */
export async function exportBatchArchive(batchId: string) {
  const batch = await prisma.clipMixerBatch.findUnique({
    where: { id: batchId },
    include: {
      items: {
        where: {
          status: { in: ["RENDERED", "UPLOADED"] },
        },
        include: {
          folder: { select: { name: true } },
          account: { select: { id: true, tiktokUsername: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!batch || batch.items.length === 0) {
    throw new Error("No rendered or uploaded videos available to package for download.");
  }

  // Map unique accounts to directories: Account_1, Account_2, ...
  const uniqueAccountsMap = new Map<string, { id: string; username: string }>();
  for (const item of batch.items) {
    const username = item.account?.tiktokUsername || "unknown";
    if (!uniqueAccountsMap.has(item.accountId)) {
      uniqueAccountsMap.set(item.accountId, { id: item.accountId, username });
    }
  }

  const sortedAccounts = Array.from(uniqueAccountsMap.values()).sort((a, b) =>
    a.username.localeCompare(b.username)
  );

  const accountFolderMap = new Map<string, string>();
  sortedAccounts.forEach((acc, idx) => {
    accountFolderMap.set(acc.id, `Account_${idx + 1}`);
  });

  // Ensure files are present locally or download from R2
  const publicDir = path.join(process.cwd(), "public");
  const tempDir = path.join(publicDir, "uploads", "clip-mixer", "archives", `export_${batchId}_${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const archiveName = `campaign_export_${batchId.substring(0, 8)}_${Date.now()}.tar`;
  const archivePath = path.join(publicDir, "uploads", "clip-mixer", "archives", archiveName);

  let totalPackaged = 0;

  for (const item of batch.items) {
    if (!item.renderedVideoUrl) continue;
    const localPath = path.join(publicDir, item.renderedVideoUrl);
    
    if (!fs.existsSync(localPath)) {
      const r2Key = `uploads/clip-mixer-renders/render_${item.id}.mp4`;
      await downloadFromR2(r2Key, localPath);
    }

    if (fs.existsSync(localPath)) {
      const accountFolder = accountFolderMap.get(item.accountId) || "Account_1";
      const subfolderName = (item.folder?.name || "root").replace(/[^a-zA-Z0-9_-]/g, "_");
      
      const targetDir = path.join(tempDir, accountFolder, subfolderName);
      fs.mkdirSync(targetDir, { recursive: true });

      // Filename derived from the subfolder name, formatted nicely
      const clipIndexStr = String(totalPackaged + 1).padStart(2, "0");
      const filename = `${subfolderName}_${clipIndexStr}.mp4`;

      fs.copyFileSync(localPath, path.join(targetDir, filename));
      totalPackaged++;
    }
  }

  if (totalPackaged === 0) {
    throw new Error("No rendering files could be copied for zipping.");
  }

  // Run tar command
  await execAsync(`tar -cf "${archivePath}" -C "${tempDir}" .`, { maxBuffer: 200 * 1024 * 1024 });

  // Cleanup temp files
  try { fs.rmSync(tempDir, { recursive: true }); } catch {}

  // Upload archive package to Cloudflare R2
  const r2ArchiveKey = `uploads/clip-mixer/archives/${archiveName}`;
  await uploadToR2(archivePath, r2ArchiveKey);

  const stats = fs.statSync(archivePath);

  return {
    downloadUrl: `/uploads/clip-mixer/archives/${archiveName}`,
    size: stats.size,
    accountsCount: sortedAccounts.length,
    totalVideos: totalPackaged,
  };
}
