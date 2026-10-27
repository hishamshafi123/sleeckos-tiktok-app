import prisma from "@/lib/db";
import { getMultiplierDriveClient } from "@/app/api/managed/multiplier/google/drive-helper";
import { GoogleGenAI } from "@google/genai";
import type { Prisma } from "@prisma/client";
import crypto from "crypto";
import { spawn, execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { getRemotionBundle } from "../remotion-bundle";
import { enqueueRender } from "./style-lab";
import { LAYERED_TEMPLATE_KEY, coerceLayers } from "../style-lab/layers";
import { SAMPLE_LYRIC_LINES } from "../style-lab/schema";
import { assertVideoCaptionUnique } from "./campaigns";
import {
  getMultiplierPerformanceState,
  RENDER_ADMISSION_POOL_LIMIT,
  renderAdmissionController,
} from "./multiplier-performance";

// Directory constants
const UPLOADS_DIR = path.join(process.cwd(), "public", "uploads", "multiplier");
const VARIATIONS_DIR = path.join(UPLOADS_DIR, "variations");
const STILLS_DIR = path.join(UPLOADS_DIR, "stills");
const OUTPUTS_DIR = path.join(UPLOADS_DIR, "outputs");

function ensureDirsExist() {
  [VARIATIONS_DIR, STILLS_DIR, OUTPUTS_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

/**
 * Make an uploaded variation playable in browsers and uniform for the render
 * pipeline. HEVC/H.265 (common in iPhone screen recordings) does not play in
 * Chrome/Edge <video> — the preview box stays black — so anything that isn't
 * h264/yuv420p is transcoded; already-compatible files just get a faststart
 * remux (moov atom first) so previews start instantly.
 * Never fails the upload: on any error the original file is kept.
 */
async function normalizeVariationVideo(filePath: string): Promise<void> {
  const execFileAsync = promisify(execFile);
  const tmpOut = `${filePath}.norm.mp4`;
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=codec_name,pix_fmt",
      "-of", "csv=p=0", filePath,
    ]);
    const [codec, pixFmt] = stdout.trim().split(",").map((s) => s.trim());
    const compatible = codec === "h264" && (!pixFmt || pixFmt === "yuv420p");

    const args = compatible
      ? ["-y", "-v", "error", "-i", filePath, "-c", "copy", "-movflags", "+faststart", tmpOut]
      : [
          "-y", "-v", "error", "-i", filePath,
          "-map", "0:v:0", "-map", "0:a?",
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
          "-c:a", "aac", "-movflags", "+faststart", tmpOut,
        ];
    await execFileAsync("ffmpeg", args);
    fs.renameSync(tmpOut, filePath);
    if (!compatible) {
      console.log(`[Multiplier] Transcoded ${codec || "unknown"}/${pixFmt || "?"} upload to h264: ${path.basename(filePath)}`);
    }
  } catch (err) {
    try { if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut); } catch {}
    console.warn(`[Multiplier] Video normalization skipped for ${path.basename(filePath)}:`, err);
  }
}

// ─── Service Functions ────────────────────────────────────────────────────────

export async function createGroup(data: {
  name: string;
  campaignId: string;
  styleId: string;
  mappingMode?: "each" | "distribute";
  settings?: any;
  createdBy?: string;
}) {
  ensureDirsExist();
  return prisma.multiplierGroup.create({
    data: {
      name: data.name,
      campaignId: data.campaignId,
      styleId: data.styleId,
      mappingMode: data.mappingMode || "each",
      settings: data.settings || {},
      createdBy: data.createdBy,
    },
  });
}

export async function addVariation(groupId: string, tempFilePath: string, originalFileName: string) {
  ensureDirsExist();
  const ext = path.extname(originalFileName) || ".mp4";
  const id = crypto.randomUUID();
  const targetFileName = `var_${id}${ext}`;
  const targetPath = path.join(VARIATIONS_DIR, targetFileName);

  fs.copyFileSync(tempFilePath, targetPath);
  fs.unlinkSync(tempFilePath);

  // Ensure browser-playable h264/yuv420p + faststart (HEVC uploads preview black).
  await normalizeVariationVideo(targetPath);

  const relativeRef = `/uploads/multiplier/variations/${targetFileName}`;

  // Find next order
  const count = await prisma.multiplierGroupVariation.count({ where: { groupId } });

  return prisma.multiplierGroupVariation.create({
    data: {
      groupId,
      videoRef: relativeRef,
      order: count,
    },
  });
}

export async function transcribeGroup(groupId: string): Promise<string> {
  const group = await prisma.multiplierGroup.findUnique({
    where: { id: groupId },
    include: { variations: { orderBy: { order: "asc" } } },
  });

  if (!group) throw new Error("Group not found");
  if (group.variations.length === 0) throw new Error("No video variations found on this group");

  // Get the first variation to run alignment
  const variation = group.variations[0];
  const videoLocalPath = path.join(process.cwd(), "public", variation.videoRef);

  if (!fs.existsSync(videoLocalPath)) {
    throw new Error(`Video file does not exist on disk: ${variation.videoRef}`);
  }

  // Update status to TRANSCRIBING
  await prisma.multiplierGroup.update({
    where: { id: groupId },
    data: { transcriptStatus: "TRANSCRIBING" },
  });

  const tempJsonPath = path.join(os.tmpdir(), `transcription_${groupId}.json`);

  const cmd = [
    `./venv/bin/python3 "scripts/lyrical_composer.py"`,
    `-i "${videoLocalPath}"`,
    `-o "/dev/null"`,
    `--save-json "${tempJsonPath}"`,
    `--model "tiny"`,
    `--device "cpu"`,
  ].join(" ");

  console.log(`[Multiplier Transcribe] Running command: ${cmd}`);

  return new Promise<string>((resolve, reject) => {
    const { exec } = require("child_process");
    exec(
      cmd,
      {
        maxBuffer: 1024 * 1024 * 50,
        // Long videos can take well past 5 minutes on a shared CPU.
        timeout: 900000,
        env: { ...process.env, HF_HOME: process.env.HF_HOME || "/home/nextjs/.cache/huggingface" },
      },
      async (error: any, stdout: string, stderr: string) => {
        // Every branch must settle the promise even if the status update
        // throws — when a group is deleted mid-transcription this update hits
        // P2025, and throwing here before reject() leaves the returned promise
        // pending forever, wedging the whole bulk-batch pipeline behind the
        // isBulkProcessing lock.
        const markFailed = async (detail: string) => {
          try {
            await prisma.multiplierGroup.update({
              where: { id: groupId },
              data: { transcriptStatus: "FAILED", errorMessage: detail },
            });
          } catch (markErr) {
            console.error("[Multiplier Transcribe] Could not mark group FAILED (deleted mid-run?):", markErr);
          }
        };

        if (error) {
          console.error("[Multiplier Transcribe] stable-ts execution failed:", stderr);
          // Include the stderr tail so the item's error text shows WHY it failed
          // (timeout, missing model, out of memory, etc.) without log access.
          const stderrTail = (stderr || "").trim().slice(-300);
          const reason = error.killed ? "worker timed out after 900s" : error.message;
          const detail = `Transcription failed: ${reason}${stderrTail ? ` — stderr: ${stderrTail}` : ""}`;
          await markFailed(detail);
          return reject(new Error(detail));
        }

        if (!fs.existsSync(tempJsonPath)) {
          await markFailed("Transcription JSON file was not generated by worker");
          return reject(new Error("Transcription JSON file not found"));
        }

        try {
          const jsonContent = fs.readFileSync(tempJsonPath, "utf-8");
          const wordList = JSON.parse(jsonContent);

          // Cleanup temp file
          try {
            fs.unlinkSync(tempJsonPath);
          } catch {}

          // Save transcript as JSON string on group
          const transcriptStr = JSON.stringify(wordList);
          await prisma.multiplierGroup.update({
            where: { id: groupId },
            data: {
              transcript: transcriptStr,
              transcriptStatus: "TRANSCRIBED",
              errorMessage: null,
            },
          });

          resolve(transcriptStr);
        } catch (err: any) {
          reject(err);
        }
      }
    );
  });
}

type GroupWithCampaign = {
  transcript: string | null;
  campaign: {
    title: string;
    type: string;
    description: string;
    brief: string;
    infoContent: string | null;
  } | null;
};

// Retry transient Gemini failures (rate limits, 5xx, network errors) with
// exponential backoff. ApiError from @google/genai carries an HTTP `status`;
// 400s/auth errors are permanent and surface immediately.
function isRetryableGeminiError(err: any): boolean {
  const status = err?.status;
  if (typeof status === "number") {
    return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
  }
  // No HTTP status → network-level failure (fetch failed, reset, timeout)
  const msg = String(err?.message || "").toLowerCase();
  return /fetch failed|econnreset|etimedout|econnrefused|socket|network|timed out/.test(msg);
}

const GEMINI_RETRY_DELAYS_MS = [2000, 8000, 20000]; // up to 3 attempts, + jitter

async function callGeminiWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt <= GEMINI_RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (attempt === GEMINI_RETRY_DELAYS_MS.length || !isRetryableGeminiError(err)) {
        throw err;
      }
      const delay = GEMINI_RETRY_DELAYS_MS[attempt] + Math.random() * 1000;
      console.warn(`[Multiplier Gemini] Attempt ${attempt + 1} failed (${err?.status ?? err?.message}); retrying in ${Math.round(delay)}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}

// Shared Gemini pipeline: builds the prompt, calls the model, parses hook texts.
async function generateHookTexts(group: GroupWithCampaign, count: number, useCampaignContext: boolean, customPrompt?: string): Promise<string[]> {
  if (!group.transcript) throw new Error("Group has not been transcribed yet. Run transcription first.");

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY environment variable is missing");

  // Format transcript into raw readable text
  let rawText = "";
  try {
    const wordList = JSON.parse(group.transcript);
    if (Array.isArray(wordList)) {
      rawText = wordList.map((w: any) => w.word || w.text || "").join(" ");
    } else {
      rawText = String(group.transcript);
    }
  } catch {
    rawText = group.transcript;
  }

  let campaignContextPrompt = "";
  if (useCampaignContext && group.campaign) {
    campaignContextPrompt = `
CAMPAIGN CONTEXT:
Campaign Title: ${group.campaign.title}
Type: ${group.campaign.type}
Description: ${group.campaign.description}
Brief: ${group.campaign.brief}
Info messaging context: ${group.campaign.infoContent || "None"}
`;
  }

  const systemInstruction = `You are an editorial and political video caption writing assistant.
Your goal is to generate short, factual, and high-impact headlines or summaries based on the video transcript.
The output MUST look like standard breaking-news bars or credible journalistic cards, NOT casual entertainment.
Do NOT use emojis, clickbait questions, or hashtags. Keep the phrasing brief, serious, and informative.`;

  let prompt = customPrompt;
  if (!prompt) {
    prompt = `
Generate exactly ${count} unique video captions or hook headlines summarizing this video transcript.
${campaignContextPrompt}
VIDEO TRANSCRIPT:
"${rawText}"

Format your response strictly as a JSON array of strings, like this:
["First hook headline", "Second hook headline", "Third hook headline"]
Do not add any other markdown wrapper like \`\`\`json or text blocks. Generate only the raw JSON array.`;
  } else {
    // Sync hooks count in custom prompt if specified
    prompt = prompt.replace(/Generate exactly \d+/i, `Generate exactly ${count}`);
    // Always append strict JSON format instructions if not present to ensure parseability
    if (!prompt.includes("Format your response strictly as a JSON array of strings")) {
      prompt += `\n\nFormat your response strictly as a JSON array of strings, like this:\n["First hook headline", "Second hook headline", "Third hook headline"]\nDo not add any other markdown wrapper like \`\`\`json or text blocks. Generate only the raw JSON array.`;
    }
  }

  const ai = new GoogleGenAI({ apiKey });
  const response = await callGeminiWithRetry(() =>
    ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        systemInstruction,
      },
    })
  );

  const responseText = response.text || "";
  console.log("[Multiplier Gemini Response]:", responseText);

  try {
    // Strip code block markers if Gemini included them
    let cleaned = responseText.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```json\s*/, "").replace(/^```\s*/, "").replace(/\s*```$/, "");
    }
    const hooks = JSON.parse(cleaned);
    if (Array.isArray(hooks)) {
      return hooks.map((h: any) => String(h).trim()).filter((h: string) => h.length > 0);
    }
  } catch (parseErr) {
    console.error("[Multiplier Gemini Parse Error]:", parseErr, responseText);
  }

  // Fallback line splits if JSON parse failed
  const lines = responseText
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^-\s*/, "").replace(/^"\s*/, "").replace(/\s*"$/, ""))
    .filter((l) => l.length > 3 && !l.startsWith("[") && !l.startsWith("]"));

  if (lines.length > 0) {
    return lines.slice(0, count);
  }

  throw new Error("Failed to parse Gemini generated hooks. Please check format or retry.");
}

export async function generateHooks(groupId: string, count: number, useCampaignContext: boolean, customPrompt?: string): Promise<string[]> {
  const group = await prisma.multiplierGroup.findUnique({
    where: { id: groupId },
    include: { campaign: true },
  });

  if (!group) throw new Error("Group not found");
  if (!group.transcript) throw new Error("Group has not been transcribed yet. Run transcription first.");

  const hooks = await generateHookTexts(group, count, useCampaignContext, customPrompt);

  // Replace the group's hook list with the generated set
  await prisma.multiplierHook.deleteMany({ where: { groupId } });
  for (let i = 0; i < hooks.length; i++) {
    await prisma.multiplierHook.create({
      data: {
        groupId,
        text: hooks[i].trim(),
        source: "ai",
        order: i,
      },
    });
  }

  return hooks;
}

// Regenerates the text of a single existing hook using the same Gemini pipeline.
export async function regenerateHook(hookId: string) {
  const hook = await prisma.multiplierHook.findUnique({
    where: { id: hookId },
  });
  if (!hook) throw new Error("Hook not found");

  const group = await prisma.multiplierGroup.findUnique({
    where: { id: hook.groupId },
    include: { campaign: true },
  });
  if (!group) throw new Error("Group not found");
  if (!group.transcript) throw new Error("Group has not been transcribed yet. Run transcription first.");

  const texts = await generateHookTexts(group, 1, !!group.campaignId);
  const newText = (texts[0] || "").trim();
  if (!newText) throw new Error("Gemini returned an empty hook. Please retry.");

  return prisma.multiplierHook.update({
    where: { id: hookId },
    data: { text: newText, source: "ai" },
  });
}

export async function addManualHook(groupId: string, text: string) {
  const count = await prisma.multiplierHook.count({ where: { groupId } });
  return prisma.multiplierHook.create({
    data: {
      groupId,
      text: text.trim(),
      source: "manual",
      order: count,
    },
  });
}

// Hooks-off bulk mode: `count` placeholder hook rows with EMPTY text (no
// Gemini call). startGroupRender still maps one output per hook, and the
// render worker skips the caption still/overlay for empty hook text, so the
// group yields N identical overlay-free outputs.
export async function createEmptyHooks(groupId: string, count: number): Promise<void> {
  await prisma.multiplierHook.deleteMany({ where: { groupId } });
  for (let i = 0; i < count; i++) {
    await prisma.multiplierHook.create({
      data: {
        groupId,
        text: "",
        source: "manual",
        order: i,
      },
    });
  }
}

// Custom-hook bulk mode: the operator pasted hooks per video (GSheet paste in
// bulk intake, stored on the group). `count` hook rows are created by cycling
// the pasted set in order — 3 pasted hooks × 15 variations yields
// h1,h2,h3,h1,h2,h3,… so every variation still gets a hook.
export async function createCustomHooks(groupId: string, hooks: string[], count: number): Promise<void> {
  await prisma.multiplierHook.deleteMany({ where: { groupId } });
  for (let i = 0; i < count; i++) {
    await prisma.multiplierHook.create({
      data: {
        groupId,
        text: hooks[i % hooks.length],
        source: "manual",
        order: i,
      },
    });
  }
}

export async function updateHook(hookId: string, text: string) {
  return prisma.multiplierHook.update({
    where: { id: hookId },
    data: { text: text.trim() },
  });
}

export async function previewOutputCount(groupId: string): Promise<number> {
  const group = await prisma.multiplierGroup.findUnique({
    where: { id: groupId },
    include: {
      _count: {
        select: { variations: true, hooks: true },
      },
    },
  });
  if (!group) return 0;
  const vCount = group._count.variations;
  const hCount = group._count.hooks;

  if (group.mappingMode === "distribute") {
    return hCount; // each hook used exactly once
  }
  return vCount * hCount; // each hook on each variation
}

// Pillow (scripts/generate_still.py) only supports these 4 built-in style
// keys. Anything else — layered styles, brat/imported/ai Style Lab templates —
// renders through Remotion (see renderCaptionStillRemotion).
const PILLOW_BUILTIN_STYLE_IDS = ["news-lower-third", "breaking-headline", "subtitle-box", "quote-card"];

export async function renderCaptionStill(
  styleId: string,
  hookText: string,
  settings: any,
  outputId: string
): Promise<string> {
  ensureDirsExist();
  const stillFileName = `still_${outputId}.png`;
  const stillPath = path.join(STILLS_DIR, stillFileName);

  let finalStyleId = styleId;
  let customProps = settings || {};
  let savedLayers: unknown = null;

  // If styleId is a SavedStyle UUID, resolve it
  if (styleId.length > 20) {
    const savedStyle = await prisma.savedStyle.findUnique({
      where: { id: styleId }
    });
    if (savedStyle) {
      finalStyleId = savedStyle.templateKey;
      savedLayers = (savedStyle as any).layers;
      let savedParams: any = savedStyle.params;
      if (typeof savedParams === "string") {
        try {
          savedParams = JSON.parse(savedParams);
          if (typeof savedParams === "string") {
            savedParams = JSON.parse(savedParams);
          }
        } catch {
          savedParams = {};
        }
      }
      if (!savedParams) savedParams = {};
      customProps = {
        ...customProps,
        ...savedParams
      };

      // Legacy rows (pre-Style-Lab saves) sometimes stored a StyleTemplate
      // UUID as templateKey instead of the composition key. Self-heal: resolve
      // the id to its key; if the template is gone, fail with an actionable
      // message instead of Remotion's cryptic "composition not found".
      if (finalStyleId.length > 20 && !PILLOW_BUILTIN_STYLE_IDS.includes(finalStyleId)) {
        const tpl = await prisma.styleTemplate.findUnique({
          where: { id: finalStyleId },
          select: { key: true },
        });
        if (tpl) {
          finalStyleId = tpl.key;
        } else {
          throw new Error(
            `[Multiplier] Saved style "${savedStyle.name}" (${styleId}) references template ${finalStyleId}, ` +
            `which no longer exists. Re-save the style in Style Lab (or point it at a current template) and retry the batch.`
          );
        }
      }
    }
  }

  // Non-Pillow styles (incl. any style with a layer stack) → Remotion.
  const layers = coerceLayers(savedLayers);
  if (!PILLOW_BUILTIN_STYLE_IDS.includes(finalStyleId) || layers.length > 0) {
    return renderCaptionStillRemotion({
      styleId,
      templateKey: finalStyleId,
      layers,
      params: customProps,
      hookText,
      stillPath,
    });
  }

  // Pillow path (built-in styles only) — unchanged.
  const fontSize = customProps.fontSize ?? 32;
  const fontColor = customProps.fontColor ?? customProps.textColor ?? "#FFFFFF";
  const bgStripColor = customProps.bgStripColor ?? customProps.bgColor ?? "#000000";
  const bgStripOpacity = customProps.bgStripOpacity ?? customProps.bgOpacity ?? 0.85;
  const positionYPercent = customProps.positionYPercent ?? customProps.positionY ?? 75;
  const accentColor = customProps.accentColor ?? "#E11D48";
  const author = customProps.author || "";

  const pythonExecutable = fs.existsSync(path.join(process.cwd(), "venv", "bin", "python3"))
    ? "./venv/bin/python3"
    : "python3";

  const fontFamily = customProps.fontFamily || "";

  const pythonArgs = [
    "scripts/generate_still.py",
    "--text", hookText,
    "--font-size", String(fontSize),
    "--font-color", fontColor,
    "--bg-color", bgStripColor,
    "--bg-opacity", String(bgStripOpacity),
    "--position-y", String(positionYPercent),
    "--style", finalStyleId,
    "--accent-color", accentColor,
    "--author", author,
    "--font-family", fontFamily,
    "--output", stillPath,
  ];

  return new Promise<string>((resolve, reject) => {
    const { spawn } = require("child_process");
    const proc = spawn(pythonExecutable, pythonArgs);

    let stderr = "";
    proc.stderr.on("data", (data: any) => {
      stderr += data.toString();
    });

    proc.on("close", (code: number) => {
      if (code === 0 && fs.existsSync(stillPath)) {
        resolve(stillPath);
      } else {
        reject(new Error(`Pillow generating overlay failed with code ${code}. Stderr: ${stderr}`));
      }
    });
  });
}

const captionStillCacheRenders = new Map<string, Promise<void>>();

/**
 * Remotion still path for styles Pillow can't render (layered styles, Style
 * Lab templates like brat-lyrics/imported/ai_*). Hook text is wired the way
 * style-lab's renderTestSample shapes inputProps: quoteText + text carry the
 * hook (quote-bound layers and quote comps read quoteText; flat text params
 * read text), author comes from the merged params, and the coerced layer
 * stack rides along for the layered-style comp. Sample lyric lines are
 * included so lyric-bound layers/comps have content (comps ignore props they
 * don't read).
 *
 * Renders the mid-composition frame (entry animations completed) through the
 * shared style-lab render lanes. Results are cached by content hash in
 * STILLS_DIR: repeated hooks across groups/outputs reuse the rendered PNG
 * ("render once, composite many"). The returned path is always a per-output
 * COPY — the render worker deletes it after compositing; the cache file
 * stays. Failures throw naming the style — never a silent Pillow fallback.
 */
async function renderCaptionStillRemotion(opts: {
  styleId: string;
  templateKey: string;
  layers: ReturnType<typeof coerceLayers>;
  params: any;
  hookText: string;
  stillPath: string;
}): Promise<string> {
  const { styleId, templateKey, layers, params, hookText, stillPath } = opts;
  const layered = layers.length > 0;
  const compositionId = layered ? LAYERED_TEMPLATE_KEY : templateKey;
  const styleLabel = `${styleId} (${compositionId})`;

  const inputProps: Record<string, any> = {
    ...params,
    lines: SAMPLE_LYRIC_LINES,
    quoteText: hookText,
    text: hookText,
    author: params?.author ?? "",
    ...(layered ? { layers } : {}),
  };

  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify({ v: 1, styleId, compositionId, inputProps }))
    .digest("hex");
  const cachePath = path.join(STILLS_DIR, `still_cache_${hash}.png`);

  const cacheIsReady = (): boolean => {
    try {
      return fs.statSync(cachePath).size > 1024;
    } catch {
      return false;
    }
  };
  const reuseCache = (): boolean => {
    if (!cacheIsReady()) return false;
    try {
      fs.copyFileSync(cachePath, stillPath);
      return true;
    } catch {
      return false;
    }
  };

  if (reuseCache()) return stillPath;

  const existingRender = captionStillCacheRenders.get(cachePath);
  if (existingRender) {
    await existingRender;
  } else {
    const tempPath = path.join(
      STILLS_DIR,
      `still_cache_${hash}.${process.pid}.${crypto.randomUUID()}.tmp.png`
    );
    const renderPromise = enqueueRender(async () => {
      if (cacheIsReady()) return;
      try {
        const bundleLocation = await getRemotionBundle();
        const browserExecutable = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
        const browser = await openBrowser("chrome", { browserExecutable });
        try {
          const composition = await selectComposition({
            serveUrl: bundleLocation,
            id: compositionId,
            inputProps,
            browserExecutable,
            puppeteerInstance: browser,
          });
          const frame = Math.max(0, Math.floor(composition.durationInFrames / 2));
          await renderStill({
            composition,
            serveUrl: bundleLocation,
            output: tempPath,
            inputProps,
            frame,
            browserExecutable,
            puppeteerInstance: browser,
          });
        } finally {
          await browser.close({ silent: true });
        }
        if (!fs.existsSync(tempPath) || fs.statSync(tempPath).size <= 1024) {
          throw new Error("renderer finished but produced no usable output");
        }
        await fs.promises.rename(tempPath, cachePath);
      } catch (err: any) {
        throw new Error(
          `[Multiplier] Remotion caption-still render failed for style ${styleLabel}: ${err?.message || err}`
        );
      } finally {
        try { await fs.promises.unlink(tempPath); } catch {}
      }
    });
    captionStillCacheRenders.set(cachePath, renderPromise);
    try {
      await renderPromise;
    } finally {
      if (captionStillCacheRenders.get(cachePath) === renderPromise) {
        captionStillCacheRenders.delete(cachePath);
      }
    }
  }

  if (!reuseCache()) {
    throw new Error(`[Multiplier] Remotion caption-still cache was not published for style ${styleLabel}`);
  }
  return stillPath;
}

export async function composeOutput(
  variationRef: string,
  stillPath: string,
  outputId: string,
  settings: any
): Promise<string> {
  ensureDirsExist();
  const inputVideoPath = path.join(process.cwd(), "public", variationRef);
  if (!fs.existsSync(inputVideoPath)) throw new Error(`Source video not found: ${variationRef}`);

  const outputFileName = `multi_${outputId}.mp4`;
  const localOutputPath = path.join(OUTPUTS_DIR, outputFileName);

  const hookDuration = settings?.hookDuration ?? 5;
  const animType = settings?.animationType ?? "NONE";
  const animDuration = settings?.animationDuration ?? 0.5;

  // Normalize the canvas to 720x1280 BEFORE overlay: the still is rendered at
  // 720x1280, and encoding a 1080p source is ~2.25x the pixels for no benefit
  // (TikTok re-compresses above ~5-10 Mbps anyway).
  const canvasFilter = `scale='if(gte(iw/ih,720/1280),-1,720)':'if(gte(iw/ih,720/1280),1280,-1)',crop=720:1280`;

  let filterComplex = "";
  if (animType === "FADE_IN" && animDuration > 0) {
    filterComplex = `[0:v]${canvasFilter}[bg];[1:v]fade=in:st=0:d=${animDuration}:alpha=1[overlay_fade];[bg][overlay_fade]overlay=x=0:y=0:enable='lt(t,${hookDuration})'[v]`;
  } else if (animType === "SLIDE_UP" && animDuration > 0) {
    // slides Y up from +60px to 0px
    filterComplex = `[0:v]${canvasFilter}[bg];[bg][1:v]overlay=x=0:y='if(lt(t,${animDuration}), 60*(1-t/${animDuration}), 0)':enable='lt(t,${hookDuration})'[v]`;
  } else {
    filterComplex = `[0:v]${canvasFilter}[bg];[bg][1:v]overlay=x=0:y=0:enable='lt(t,${hookDuration})'[v]`;
  }

  const ffmpegArgs = [
    "-y",
    "-i", inputVideoPath,
    "-i", stillPath,
    "-filter_complex", filterComplex,
    "-map", "[v]",
    "-map", "0:a?",
    "-c:v", "libx264",
    // veryfast ~3-5x faster than medium on the shared CPU; the 8M maxrate cap
    // keeps file sizes bounded, so the tradeoff is only a slight efficiency loss.
    "-preset", "veryfast",
    // x264 sizes its thread pool from the HOST core count and ignores the
    // container's CPU limit — pin it so concurrent renders don't thrash.
    "-threads", String(FFMPEG_THREADS),
    "-crf", "26",
    "-maxrate", "8M",
    "-bufsize", "16M",
    "-r", "30",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    "-shortest",
    localOutputPath,
  ];

  return new Promise<string>((resolve, reject) => {
    const { spawn } = require("child_process");
    const proc = spawn("ffmpeg", ffmpegArgs);

    let stderr = "";
    proc.stderr.on("data", (data: any) => {
      stderr += data.toString();
    });

    proc.on("close", (code: number) => {
      if (code === 0) {
        resolve(`/uploads/multiplier/outputs/${outputFileName}`);
      } else {
        console.error("[Multiplier Composer FFmpeg error]:", stderr);
        reject(new Error(`FFmpeg processing failed with code ${code}. Stderr: ${stderr}`));
      }
    });
  });
}

// Hooks-off bulk mode: no caption still exists, so there is nothing to
// overlay. Re-encode the source video on the same 720x1280 canvas and with
// the same encode settings as composeOutput so downstream export/upload
// handling stays uniform.
export async function composeOutputPlain(
  variationRef: string,
  outputId: string
): Promise<string> {
  ensureDirsExist();
  const inputVideoPath = path.join(process.cwd(), "public", variationRef);
  if (!fs.existsSync(inputVideoPath)) throw new Error(`Source video not found: ${variationRef}`);

  const outputFileName = `multi_${outputId}.mp4`;
  const localOutputPath = path.join(OUTPUTS_DIR, outputFileName);

  const canvasFilter = `scale='if(gte(iw/ih,720/1280),-1,720)':'if(gte(iw/ih,720/1280),1280,-1)',crop=720:1280`;

  const ffmpegArgs = [
    "-y",
    "-i", inputVideoPath,
    "-filter_complex", `[0:v]${canvasFilter}[v]`,
    "-map", "[v]",
    "-map", "0:a?",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-threads", String(FFMPEG_THREADS),
    "-crf", "26",
    "-maxrate", "8M",
    "-bufsize", "16M",
    "-r", "30",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    "-shortest",
    localOutputPath,
  ];

  return new Promise<string>((resolve, reject) => {
    const proc = spawn("ffmpeg", ffmpegArgs);

    let stderr = "";
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(`/uploads/multiplier/outputs/${outputFileName}`);
      } else {
        console.error("[Multiplier Composer FFmpeg error]:", stderr);
        reject(new Error(`FFmpeg processing failed with code ${code}. Stderr: ${stderr}`));
      }
    });
  });
}

// ─── Background Queue Rendering orchestrator ───────────────────────────────

let isQueueProcessing = false;
let isRenderPaused = false;
let queueWakeupRequested = false;

export function getRenderQueueState() {
  return { paused: isRenderPaused, processing: isQueueProcessing };
}

// Outputs left in RENDERING by a crash/restart are never picked up again
// (the loop only fetches PENDING) — reset them so the queue can move. Legacy
// claims predate renderHeartbeatAt, so updatedAt is their fallback only.
export async function recoverStaleRenderingOutputs(staleMinutes = 2): Promise<number> {
  const staleBefore = new Date(Date.now() - staleMinutes * 60 * 1000);
  const reset = await prisma.multiplierOutput.updateMany({
    where: {
      status: "RENDERING",
      OR: [
        { renderHeartbeatAt: { lt: staleBefore } },
        { renderHeartbeatAt: null, updatedAt: { lt: staleBefore } },
      ],
    },
    data: { status: "PENDING", renderLeaseId: null, renderHeartbeatAt: null },
  });
  if (reset.count > 0) {
    console.log(`[Multiplier Worker] Recovered ${reset.count} output(s) stuck in RENDERING`);
  }
  return reset.count;
}

export async function pauseRenderQueue() {
  isRenderPaused = true;
  return getRenderQueueState();
}

export async function resumeRenderQueue() {
  isRenderPaused = false;
  await recoverStaleRenderingOutputs();
  triggerQueueWorker();
  return getRenderQueueState();
}

export async function triggerQueueWorker() {
  if (isRenderPaused) return;
  if (isQueueProcessing) {
    queueWakeupRequested = true;
    return;
  }
  isQueueProcessing = true;
  queueWakeupRequested = false;
  processRenderQueue()
    .catch((err) => {
      console.error("[Multiplier Worker] Queue processing failed:", err);
    })
    .finally(() => {
      isQueueProcessing = false;
      if (queueWakeupRequested) {
        queueWakeupRequested = false;
        triggerQueueWorker();
      }
    });
}

// Boot/cron resume: a restart strands PENDING outputs (the in-memory worker
// flag died with the process). Unlike resumeRenderQueue() this does NOT clear
// an operator pause — triggerQueueWorker itself stays paused.
export async function resumeRenderQueueIfWorkPending(): Promise<{ recovered: number; pending: number }> {
  const recovered = await recoverStaleRenderingOutputs();
  const pending = await prisma.multiplierOutput.count({ where: { status: "PENDING" } });
  if (pending > 0) triggerQueueWorker();
  return { recovered, pending };
}

// Admission is dynamic; the physical pool is sized for the largest env/preset
// limit. FFmpeg thread pinning remains env-tunable for the host CPU budget.
const FFMPEG_THREADS = Math.max(1, parseInt(process.env.FFMPEG_THREADS || "2", 10) || 2);

async function processRenderQueue() {
  // A previous process may have died mid-render — recover before starting.
  await recoverStaleRenderingOutputs().catch((err) => {
    console.error("[Multiplier Worker] Stale-output recovery failed:", err);
  });
  await getMultiplierPerformanceState().catch((err) => {
    console.error("[Multiplier Worker] Performance settings load failed; using cached limits:", err);
  });

  console.log(
    `[Multiplier Worker] Starting processing render queue ` +
    `(concurrency ${renderAdmissionController.getMetrics().limit}, pool ${RENDER_ADMISSION_POOL_LIMIT})...`
  );
  await Promise.all(
    Array.from({ length: RENDER_ADMISSION_POOL_LIMIT }, (_, i) => renderWorkerLoop(i + 1))
  );

  // Sweep: groups stuck in QUEUED/RENDERING whose outputs are all terminal
  // (e.g. after a restart or a pause) get their correct final status.
  try {
    const stuckGroups = await prisma.multiplierGroup.findMany({
      where: { status: { in: ["QUEUED", "RENDERING"] } },
      include: { outputs: { select: { status: true } } },
    });
    for (const g of stuckGroups) {
      const anyActive = g.outputs.some((o) => o.status === "PENDING" || o.status === "RENDERING");
      if (anyActive) continue;
      const hasFailed = g.outputs.some((o) => o.status === "FAILED");
      await prisma.multiplierGroup.update({
        where: { id: g.id },
        data: { status: hasFailed ? "FAILED" : "COMPLETED" },
      });
    }
  } catch (err) {
    console.error("[Multiplier Worker] Group status sweep failed:", err);
  }

  try {
    const pending = await prisma.multiplierOutput.count({ where: { status: "PENDING" } });
    if (pending > 0) queueWakeupRequested = true;
  } catch (err) {
    console.error("[Multiplier Worker] Final queue recheck failed:", err);
  }
}

async function renderWorkerLoop(workerId: number) {
  while (true) {
    if (isRenderPaused) {
      console.log(`[Multiplier Worker ${workerId}] Paused by operator. Stopping loop.`);
      break;
    }

    const releaseAdmission = await renderAdmissionController.acquire();
    try {
      if (isRenderPaused) {
        console.log(`[Multiplier Worker ${workerId}] Paused by operator. Stopping loop.`);
        break;
      }

      // Atomic claim: flip exactly one PENDING output so two workers never
      // render the same video. The dedicated lease fences off an older worker
      // without being invalidated by unrelated output metadata updates.
      const candidate = await prisma.multiplierOutput.findFirst({
        where: { status: "PENDING" },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });

      if (!candidate) {
        console.log(`[Multiplier Worker ${workerId}] Queue empty. Going to sleep.`);
        break;
      }

      const renderLeaseId = crypto.randomUUID();
      const claimedAt = new Date();
      const claimed = await prisma.multiplierOutput.updateMany({
        where: { id: candidate.id, status: "PENDING" },
        data: { status: "RENDERING", renderLeaseId, renderHeartbeatAt: claimedAt },
      });
      if (claimed.count === 0) continue; // another worker claimed it first

      let leaseLost = false;
      let terminalTransitionStarted = false;
      const reportLeaseLost = (operation: string) => {
        leaseLost = true;
        console.warn(
          `[Multiplier Worker ${workerId}] Render lease lost for output ${candidate.id} during ${operation}; ` +
          "skipping further external side effects"
        );
      };

      let leaseOperation: Promise<void> = Promise.resolve();
      const updateOwnedOutput = (data: Prisma.MultiplierOutputUpdateManyMutationInput) => {
        const result = leaseOperation.then(() => prisma.multiplierOutput.updateMany({
          where: { id: candidate.id, status: "RENDERING", renderLeaseId },
          data,
        }));
        leaseOperation = result.then(() => undefined, () => undefined);
        return result;
      };

      let heartbeatInFlight = false;
      const heartbeat = async () => {
        if (heartbeatInFlight || terminalTransitionStarted || leaseLost) return;
        heartbeatInFlight = true;
        const heartbeatAt = new Date();
        try {
          const updated = await updateOwnedOutput({ renderHeartbeatAt: heartbeatAt });
          if (updated.count === 0) reportLeaseLost("heartbeat");
        } catch (err) {
          console.error(`[Multiplier Worker ${workerId}] Heartbeat failed for output ${candidate.id}:`, err);
        } finally {
          heartbeatInFlight = false;
        }
      };
      const heartbeatTimer = setInterval(() => { void heartbeat(); }, 30000);

      try {
        const output = await prisma.multiplierOutput.findUnique({
          where: { id: candidate.id },
          include: {
            group: true,
            variation: true,
            hook: true,
          },
        });
        if (!output || leaseLost) continue;

        let stillPath = "";
        try {
          await prisma.multiplierGroup.update({
            where: { id: output.groupId },
            data: { status: "RENDERING" },
          });
          if (leaseLost) continue;

          const settings = typeof output.group.settings === "string"
            ? JSON.parse(output.group.settings)
            : (output.group.settings || {});

          const hookText = output.hook.text.trim();
          let relativeVideoUrl: string;
          if (hookText) {
            // 1. Render transparent PNG still in Remotion
            // Per-variation preset (multi-preset split) wins over the group style.
            const outputStyleId = output.variation.styleId || output.group.styleId;
            console.log(`[Multiplier Worker] Rendering still for Hook: "${output.hook.text.substring(0, 30)}..."`);
            stillPath = await renderCaptionStill(outputStyleId, output.hook.text, settings, output.id);

            // 2. Composite variation with still overlay in FFmpeg
            console.log(`[Multiplier Worker] Compositing still on video: ${output.variation.videoRef}`);
            relativeVideoUrl = await composeOutput(output.variation.videoRef, stillPath, output.id, settings);

            // Delete the still PNG after success
            try {
              fs.unlinkSync(stillPath);
            } catch {}
          } else {
            // Hooks-off bulk mode: empty hook text means NO caption overlay —
            // re-encode the source video as-is.
            console.log(`[Multiplier Worker] No hook text — rendering plain output for: ${output.variation.videoRef}`);
            relativeVideoUrl = await composeOutputPlain(output.variation.videoRef, output.id);
          }

          // 3. Auto-upload to Google Drive if connected
          let driveFolderId: string | null = null;
          const finalFolderId = output.driveFolderId || settings?.driveFolderId || null;
          if (finalFolderId && !leaseLost) {
            try {
              const drive = await getMultiplierDriveClient();
              if (drive && !leaseLost) {
                const localFilePath = path.join(process.cwd(), "public", relativeVideoUrl);
                const cleanHookSlug = output.hook.text.replace(/[^a-zA-Z0-9 ]/g, "").trim().replace(/\s+/g, "_").substring(0, 40);
                const fileName = `multi_${output.id}_${cleanHookSlug || "plain"}.mp4`;

                console.log(`[Multiplier Worker] Uploading output ${output.id} to Drive Folder ${finalFolderId}`);
                const fileStream = fs.createReadStream(localFilePath);
                await drive.files.create({
                  requestBody: {
                    name: fileName,
                    parents: [finalFolderId],
                  },
                  media: {
                    mimeType: "video/mp4",
                    body: fileStream,
                  },
                  fields: "id",
                  supportsAllDrives: true,
                });
                driveFolderId = finalFolderId;
              }
            } catch (driveErr: any) {
              console.error(`[Multiplier Worker] Drive upload failed for output ${output.id}:`, driveErr?.message || driveErr);
            }
          }

          terminalTransitionStarted = true;
          const completed = await updateOwnedOutput({
            status: "COMPLETED",
            outputRef: relativeVideoUrl,
            driveFolderId,
            errorMessage: null,
            renderLeaseId: null,
            renderHeartbeatAt: null,
          });
          if (completed.count === 1) {
            await updateParentGroupStatus(output.groupId);
          } else {
            reportLeaseLost("completion");
          }
        } catch (err: any) {
          console.error(`[Multiplier Worker] Output ${output.id} failed:`, err);
          // Clean still path if stuck on disk
          if (stillPath && fs.existsSync(stillPath)) {
            try { fs.unlinkSync(stillPath); } catch {}
          }

          terminalTransitionStarted = true;
          const failed = await updateOwnedOutput({
            status: "FAILED",
            errorMessage: err.message || String(err),
            renderLeaseId: null,
            renderHeartbeatAt: null,
          });
          if (failed.count === 1) {
            await updateParentGroupStatus(output.groupId);
          } else {
            reportLeaseLost("failure");
          }
        }
      } finally {
        clearInterval(heartbeatTimer);
        await leaseOperation;
      }
    } finally {
      releaseAdmission();
    }
  }
}

async function updateParentGroupStatus(groupId: string) {
  const allOutputs = await prisma.multiplierOutput.findMany({
    where: { groupId },
    select: { status: true },
  });

  const allDone = allOutputs.every((o: any) => o.status === "COMPLETED" || o.status === "FAILED");
  if (allDone) {
    const hasFailed = allOutputs.some((o: any) => o.status === "FAILED");
    await prisma.multiplierGroup.update({
      where: { id: groupId },
      data: {
        status: hasFailed ? "FAILED" : "COMPLETED",
      },
    });
  }
}

export async function startGroupRender(groupId: string, opts?: { fresh?: boolean }) {
  const group = await prisma.multiplierGroup.findUnique({
    where: { id: groupId },
    include: {
      variations: { orderBy: { order: "asc" } },
      hooks: { orderBy: { order: "asc" } },
    },
  });

  if (!group) throw new Error("Group not found");
  if (group.variations.length === 0) throw new Error("Add at least one video variation to render");
  if (group.hooks.length === 0) throw new Error("Add at least one hook to render");

  // Resume-safe: completed outputs (and their export records) are kept — only
  // incomplete ones are replaced. Pass { fresh: true } to force a full re-render.
  let completedCombos = new Set<string>();
  if (opts?.fresh) {
    await prisma.multiplierOutput.deleteMany({ where: { groupId } });
  } else {
    await prisma.multiplierOutput.deleteMany({
      where: { groupId, status: { not: "COMPLETED" } },
    });
    const completed = await prisma.multiplierOutput.findMany({
      where: { groupId, status: "COMPLETED" },
      select: { hookId: true, variationId: true },
    });
    completedCombos = new Set(completed.map((o) => `${o.hookId}:${o.variationId}`));
  }

  // Map outputs. fixedCaption snapshots the group's custom caption (bulk
  // intake) so the posting pipeline can key the TikTok caption off the output.
  const fixedCaption = group.caption || null;
  const outputRows: Prisma.MultiplierOutputCreateManyInput[] = [];
  if (group.mappingMode === "distribute") {
    // round-robin hooks across variations
    for (let i = 0; i < group.hooks.length; i++) {
      const hook = group.hooks[i];
      const variation = group.variations[i % group.variations.length];

      if (completedCombos.has(`${hook.id}:${variation.id}`)) continue;
      outputRows.push({
        groupId,
        hookId: hook.id,
        variationId: variation.id,
        fixedCaption,
        status: "PENDING",
      });
    }
  } else {
    // each hook on each variation
    for (const hook of group.hooks) {
      for (const variation of group.variations) {
        if (completedCombos.has(`${hook.id}:${variation.id}`)) continue;
        outputRows.push({
          groupId,
          hookId: hook.id,
          variationId: variation.id,
          fixedCaption,
          status: "PENDING",
        });
      }
    }
  }
  if (outputRows.length > 0) {
    await prisma.multiplierOutput.createMany({ data: outputRows });
  }

  // Update status to QUEUED
  await prisma.multiplierGroup.update({
    where: { id: groupId },
    data: { status: "QUEUED", errorMessage: null },
  });

  // Run worker background loop
  triggerQueueWorker();

  return true;
}

export async function retryOutput(outputId: string) {
  const output = await prisma.multiplierOutput.update({
    where: { id: outputId },
    data: {
      status: "PENDING",
      errorMessage: null,
      renderLeaseId: null,
      renderHeartbeatAt: null,
    },
  });

  await prisma.multiplierGroup.update({
    where: { id: output.groupId },
    data: { status: "QUEUED" },
  });

  triggerQueueWorker();

  return output;
}

// ─── Bulk Intake (multi-video batch upload) ─────────────────────────────────

const DEFAULT_BULK_STYLE_ID = "news-lower-third";

/**
 * Deterministic round-robin preset assignment: item at `index` (0-based) gets
 * styleIds[index % styleIds.length]. Evenly splits N items across K presets
 * (15/3 → 5/5/5, 16/3 → 6/5/5) in a mixed order. Empty/blank entries fall
 * back to the default style so "Default style" can be one of the chips.
 */
export function pickRoundRobinStyle(styleIds: string[], index: number): string {
  if (styleIds.length === 0) return DEFAULT_BULK_STYLE_ID;
  return styleIds[index % styleIds.length] || DEFAULT_BULK_STYLE_ID;
}

/**
 * Persist a per-variation preset split for a group: variations (in `order`)
 * are assigned styleIds round-robin. The group's own styleId is set to the
 * first preset as the fallback for anything without an assignment. Called at
 * render-trigger time so the assignment is stored, not recomputed mid-render.
 */
export async function applyStyleSplitToGroup(groupId: string, styleIds: string[]): Promise<void> {
  const clean = styleIds.filter((s) => typeof s === "string");
  if (clean.length === 0) return;
  const variations = await prisma.multiplierGroupVariation.findMany({
    where: { groupId },
    orderBy: { order: "asc" },
    select: { id: true },
  });
  for (let i = 0; i < variations.length; i++) {
    await prisma.multiplierGroupVariation.update({
      where: { id: variations[i].id },
      data: { styleId: pickRoundRobinStyle(clean, i) },
    });
  }
  await prisma.multiplierGroup.update({
    where: { id: groupId },
    data: { styleId: pickRoundRobinStyle(clean, 0) },
  });
}

async function addFileToBulkBatch(input: {
  jobId: string;
  file: { tempPath: string; fileName: string; caption?: string | null; customHooks?: string[] };
  campaignId?: string | null;
  styleId?: string | null;
  styleIds?: string[]; // multi-preset selection — takes precedence over styleId
  createdBy?: string | null;
  namePrefix?: string | null;
  seq?: number; // 1-based position in the naming sequence
}): Promise<string | null> {
  try {
    const name = input.namePrefix && input.seq != null
      ? `${input.namePrefix} ${String(input.seq).padStart(2, "0")}`
      : input.file.fileName.replace(/\.[^.]+$/, "") || input.file.fileName;
    const styleIds = input.styleIds ?? [];
    const assignedStyle =
      styleIds.length > 0 && input.seq != null
        ? pickRoundRobinStyle(styleIds, input.seq - 1)
        : input.styleId || DEFAULT_BULK_STYLE_ID;
    const group = await prisma.multiplierGroup.create({
      data: {
        name,
        campaignId: input.campaignId || null,
        caption: input.file.caption?.trim() || null,
        customHooks: (input.file.customHooks ?? []).map((h) => h.trim()).filter((h) => h.length > 0),
        styleId: assignedStyle,
        mappingMode: "distribute",
        settings: {},
        createdBy: input.createdBy || null,
      },
    });

    // Moves the uploaded temp file into the variations directory
    await addVariation(group.id, input.file.tempPath, input.file.fileName);

    // The route has already received the upload, so the item starts at TRANSCRIBING
    await prisma.multiplierBatchJobItem.create({
      data: {
        jobId: input.jobId,
        fileName: input.file.fileName,
        status: "TRANSCRIBING",
        groupId: group.id,
      },
    });

    return group.id;
  } catch (err: any) {
    try { fs.unlinkSync(input.file.tempPath); } catch {}
    await prisma.multiplierBatchJobItem.create({
      data: {
        jobId: input.jobId,
        fileName: input.file.fileName,
        status: "FAILED",
        error: err?.message || String(err),
      },
    });
    return null;
  }
}

// Variations (outputs) per video in a bulk batch — operator-editable, clamped.
export function clampBulkHookCount(count?: number | null): number {
  if (count == null || !Number.isFinite(count)) return 15;
  return Math.min(50, Math.max(1, Math.round(count)));
}

// Creates the batch shell in RECEIVING state. Files may arrive across several
// requests (see appendToBulkBatch) — processing starts only on finalizeBulkBatch.
// namePrefix enables a "PREFIX 01, 02, …" group naming sequence; the sequence
// follows arrival order (files normally arrive one request at a time, in the
// order the operator picked them).
export async function createBulkBatch(input: {
  files: { tempPath: string; fileName: string; caption?: string | null; customHooks?: string[] }[];
  campaignId?: string | null;
  styleId?: string | null;
  styleIds?: string[]; // multi-preset selection — persisted on the job
  namePrefix?: string | null;
  hooksEnabled?: boolean | null; // false = identical outputs with NO hook overlay
  hookCount?: number | null;     // variations per video (clamped 1..50, default 15)
  createdBy?: string | null;
}): Promise<{ jobId: string; groupIds: string[] }> {
  ensureDirsExist();

  const namePrefix = input.namePrefix?.trim() || null;
  const styleIds = (input.styleIds ?? []).filter((s) => typeof s === "string");

  // Custom captions become the TikTok caption at posting time, so they must
  // be attributable — reject captions another campaign already uses.
  if (input.campaignId) {
    for (const file of input.files) {
      if (file.caption?.trim()) {
        await assertVideoCaptionUnique(file.caption.trim(), input.campaignId);
      }
    }
  }

  const job = await prisma.multiplierBatchJob.create({
    data: {
      status: "RECEIVING",
      campaignId: input.campaignId || null,
      // Legacy single-style column keeps the first preset for display compat.
      styleId: styleIds[0] || input.styleId || null,
      styleIds,
      namePrefix,
      hooksEnabled: input.hooksEnabled ?? true,
      hookCount: clampBulkHookCount(input.hookCount),
      createdBy: input.createdBy || null,
    },
  });

  const groupIds: string[] = [];
  for (let i = 0; i < input.files.length; i++) {
    const groupId = await addFileToBulkBatch({
      jobId: job.id,
      file: input.files[i],
      campaignId: input.campaignId,
      styleId: input.styleId,
      styleIds,
      createdBy: input.createdBy,
      namePrefix,
      seq: i + 1,
    });
    if (groupId) groupIds.push(groupId);
  }

  return { jobId: job.id, groupIds };
}

// Appends files to an existing RECEIVING batch (one request per file keeps
// each request under proxy body-size limits, e.g. nginx client_max_body_size).
// hooksEnabled/hookCount, when sent on an append, update the job row so the
// operator can change them any time before finalize.
export async function appendToBulkBatch(
  jobId: string,
  files: { tempPath: string; fileName: string; caption?: string | null; customHooks?: string[] }[],
  opts?: { hooksEnabled?: boolean | null; hookCount?: number | null }
): Promise<string[]> {
  ensureDirsExist();

  const job = await prisma.multiplierBatchJob.findUnique({
    where: { id: jobId },
    include: { _count: { select: { items: true } } },
  });
  if (!job) throw new Error("Batch job not found");
  if (job.status !== "RECEIVING") throw new Error("Batch job is already being processed");

  if (job.campaignId) {
    for (const file of files) {
      if (file.caption?.trim()) {
        await assertVideoCaptionUnique(file.caption.trim(), job.campaignId);
      }
    }
  }

  if (opts && (opts.hooksEnabled != null || opts.hookCount != null)) {
    await prisma.multiplierBatchJob.update({
      where: { id: jobId },
      data: {
        ...(opts.hooksEnabled != null ? { hooksEnabled: opts.hooksEnabled } : {}),
        ...(opts.hookCount != null ? { hookCount: clampBulkHookCount(opts.hookCount) } : {}),
      },
    });
  }

  const groupIds: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const groupId = await addFileToBulkBatch({
      jobId,
      file: files[i],
      campaignId: job.campaignId,
      styleId: job.styleId,
      styleIds: job.styleIds,
      createdBy: job.createdBy,
      namePrefix: job.namePrefix,
      seq: job._count.items + i + 1,
    });
    if (groupId) groupIds.push(groupId);
  }
  return groupIds;
}

// Marks the batch ready and kicks off background processing
// (fire-and-forget, same pattern as triggerQueueWorker).
export async function finalizeBulkBatch(jobId: string): Promise<void> {
  const job = await prisma.multiplierBatchJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("Batch job not found");
  if (job.status !== "RECEIVING") return; // already finalized — idempotent

  await prisma.multiplierBatchJob.update({
    where: { id: jobId },
    data: { status: "PROCESSING" },
  });

  processBulkBatch(jobId).catch((err) => {
    console.error(`[Multiplier Bulk Batch] Failed to trigger processing for job ${jobId}:`, err);
  });
}

let isBulkProcessing = false;

export async function processBulkBatch(jobId: string) {
  if (isBulkProcessing) {
    // CPU is scarce — process batches strictly one at a time. Retry shortly.
    setTimeout(() => {
      processBulkBatch(jobId).catch((err) => {
        console.error(`[Multiplier Bulk Batch] Error processing job ${jobId}:`, err);
      });
    }, 5000);
    return;
  }
  isBulkProcessing = true;

  try {
    const job = await prisma.multiplierBatchJob.findUnique({
      where: { id: jobId },
      include: { items: { orderBy: { createdAt: "asc" } } },
    });
    if (!job) return;

    const pendingItems = job.items.filter((i) => i.status !== "READY" && i.status !== "FAILED");

    // Gemini hook generation is network-bound → small concurrent pool that
    // picks up each AI-hook video as soon as its transcript lands. Custom-hook
    // and hooks-off items do not need a transcript and join this pool directly.
    const HOOK_CONCURRENCY = 2; // keep 429 pressure low; transcription is the long pole
    type HookTask = { itemId: string; groupId: string; fileName: string };
    const hookQueue: HookTask[] = [];
    let transcriptionDone = false;

    const pendingGroupIds = pendingItems.flatMap((item) => item.groupId ? [item.groupId] : []);
    const customHookGroups = job.hooksEnabled && pendingGroupIds.length > 0
      ? await prisma.multiplierGroup.findMany({
          where: { id: { in: pendingGroupIds } },
          select: { id: true, customHooks: true },
        })
      : [];
    const customHookGroupIds = new Set(
      customHookGroups.filter((group) => group.customHooks.length > 0).map((group) => group.id)
    );
    const transcriptionQueue = pendingItems.filter((item) => {
      if (!item.groupId) return true;
      if (job.hooksEnabled && !customHookGroupIds.has(item.groupId)) return true;
      hookQueue.push({ itemId: item.id, groupId: item.groupId, fileName: item.fileName });
      return false;
    });

    const hookWorker = async () => {
      while (true) {
        const task = hookQueue.shift();
        if (!task) {
          if (transcriptionDone) return;
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        try {
          await prisma.multiplierBatchJobItem.update({
            where: { id: task.itemId },
            data: { status: "GENERATING_HOOKS" },
          });
          const groupHooks = await prisma.multiplierGroup.findUnique({
            where: { id: task.groupId },
            select: { customHooks: true },
          });
          if (groupHooks && groupHooks.customHooks.length > 0) {
            // Pasted custom hooks win over both Gemini and the hooks-off mode —
            // cycled to hookCount by createCustomHooks.
            await createCustomHooks(task.groupId, groupHooks.customHooks, job.hookCount);
          } else if (job.hooksEnabled) {
            await generateHooks(task.groupId, job.hookCount, !!job.campaignId);
          } else {
            // Hooks-off: skip Gemini — placeholder rows with empty text yield
            // identical overlay-free outputs (see renderWorkerLoop).
            await createEmptyHooks(task.groupId, job.hookCount);
          }
          await prisma.multiplierBatchJobItem.update({
            where: { id: task.itemId },
            data: { status: "READY" },
          });
        } catch (err: any) {
          console.error(`[Multiplier Bulk Batch] Hook generation failed for ${task.fileName}:`, err);
          try {
            await prisma.multiplierBatchJobItem.update({
              where: { id: task.itemId },
              data: { status: "FAILED", error: err?.message || String(err) },
            });
          } catch (markErr) {
            console.error(`[Multiplier Bulk Batch] Could not mark item ${task.itemId} FAILED:`, markErr);
          }
        }
      }
    };
    const hookWorkers = Array.from({ length: HOOK_CONCURRENCY }, () => hookWorker());

    // Transcription worker pool: Whisper is CPU-bound but mostly idle-waits on
    // process I/O, so 2 parallel transcriptions roughly halve batch intake time
    // without starving renders (env-tunable for bigger boxes).
    const TRANSCRIBE_CONCURRENCY = Math.max(1, parseInt(process.env.TRANSCRIBE_CONCURRENCY || "2", 10) || 2);
    const transcribeWorker = async () => {
      for (;;) {
        const item = transcriptionQueue.shift();
        if (!item) return;
        try {
          if (!item.groupId) throw new Error("Batch item has no associated group");

          await prisma.multiplierBatchJobItem.update({
            where: { id: item.id },
            data: { status: "TRANSCRIBING", error: null },
          });
          await transcribeGroup(item.groupId);

          hookQueue.push({ itemId: item.id, groupId: item.groupId, fileName: item.fileName });
        } catch (err: any) {
          console.error(`[Multiplier Bulk Batch] Item ${item.id} (${item.fileName}) failed:`, err);
          // One bad video must not kill the batch — mark it and continue. Best-
          // effort: if this update itself throws (DB hiccup), the loop must still
          // continue; the boot resume / retry-failed path re-queues it later.
          try {
            await prisma.multiplierBatchJobItem.update({
              where: { id: item.id },
              data: { status: "FAILED", error: err?.message || String(err) },
            });
          } catch (markErr) {
            console.error(`[Multiplier Bulk Batch] Could not mark item ${item.id} FAILED:`, markErr);
          }
        }
      }
    };
    await Promise.all(Array.from({ length: TRANSCRIBE_CONCURRENCY }, () => transcribeWorker()));
    transcriptionDone = true;
    await Promise.all(hookWorkers);

    const items = await prisma.multiplierBatchJobItem.findMany({ where: { jobId } });
    const anyReady = items.some((i) => i.status === "READY");
    await prisma.multiplierBatchJob.update({
      where: { id: jobId },
      data: { status: anyReady ? "COMPLETED" : "FAILED" },
    });
  } finally {
    isBulkProcessing = false;
  }
}

export async function getBulkBatch(jobId: string) {
  return prisma.multiplierBatchJob.findUnique({
    where: { id: jobId },
    include: {
      items: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          fileName: true,
          status: true,
          groupId: true,
          error: true,
        },
      },
    },
  });
}

// Re-triggers every bulk batch left in PROCESSING by a restart/crash (or by a
// wedged run). processBulkBatch skips READY/FAILED items, so resuming is
// idempotent; the isBulkProcessing lock serializes multiple jobs on its own.
export async function resumeBulkBatchJobsIfPending(): Promise<void> {
  const stuck = await prisma.multiplierBatchJob.findMany({
    where: { status: "PROCESSING" },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  for (const j of stuck) {
    processBulkBatch(j.id).catch((err) => {
      console.error(`[Multiplier Bulk Batch] Boot resume failed for job ${j.id}:`, err);
    });
  }
}

// Re-queues every FAILED item that has a group (items that failed during
// intake have no group and cannot be retried) and restarts the batch.
// processBulkBatch skips READY items, so only the failed ones are redone.
export async function retryFailedBulkItems(jobId: string): Promise<{ retried: number }> {
  const job = await prisma.multiplierBatchJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("Batch job not found");

  const reset = await prisma.multiplierBatchJobItem.updateMany({
    where: { jobId, status: "FAILED", groupId: { not: null } },
    data: { status: "TRANSCRIBING", error: null },
  });

  await prisma.multiplierBatchJob.update({
    where: { id: jobId },
    data: { status: "PROCESSING" },
  });

  // Fire-and-forget, same pattern as finalizeBulkBatch — the isBulkProcessing
  // lock re-queues after 5s if another batch is currently running.
  processBulkBatch(jobId).catch((err) => {
    console.error(`[Multiplier Bulk Batch] Failed to reprocess job ${jobId}:`, err);
  });

  return { retried: reset.count };
}

// ─── Bulk Render ─────────────────────────────────────────────────────────────

export async function bulkRenderGroups(groupIds: string[], opts?: { fresh?: boolean }): Promise<{
  queued: string[];
  skipped: { groupId: string; reason: string }[];
}> {
  const queued: string[] = [];
  const skipped: { groupId: string; reason: string }[] = [];

  for (const groupId of groupIds) {
    const group = await prisma.multiplierGroup.findUnique({
      where: { id: groupId },
      include: { _count: { select: { variations: true, hooks: true } } },
    });

    if (!group) {
      skipped.push({ groupId, reason: "Group not found" });
      continue;
    }
    if (group.status === "QUEUED" || group.status === "RENDERING") {
      skipped.push({ groupId, reason: `Group is already ${group.status.toLowerCase()}` });
      continue;
    }
    if (group._count.variations === 0) {
      skipped.push({ groupId, reason: "Add at least one video variation to render" });
      continue;
    }
    if (group._count.hooks === 0) {
      skipped.push({ groupId, reason: "Add at least one hook to render" });
      continue;
    }

    try {
      // startGroupRender triggers the queue worker internally
      await startGroupRender(groupId, opts);
      queued.push(groupId);
    } catch (err: any) {
      skipped.push({ groupId, reason: err?.message || String(err) });
    }
  }

  return { queued, skipped };
}

// ─── Bulk Delete / Clear ─────────────────────────────────────────────────────

function deleteLocalUpload(relativeRef: string | null | undefined) {
  if (!relativeRef) return;
  try {
    const p = path.join(process.cwd(), "public", relativeRef);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {}
}

// Deletes ONLY the rendered outputs (files + rows) of the given groups and
// resets them to DRAFT — the groups themselves (source videos, hooks, style)
// stay alive in the builder. This is the queue-dashboard "clear" action.
export async function clearGroupOutputs(groupIds: string[]): Promise<{ clearedGroups: number; deletedOutputs: number }> {
  const groups = await prisma.multiplierGroup.findMany({
    where: { id: { in: groupIds } },
    include: { outputs: { select: { id: true, outputRef: true } } },
  });

  let deletedOutputs = 0;
  for (const g of groups) {
    for (const o of g.outputs) {
      deleteLocalUpload(o.outputRef);
      deletedOutputs++;
    }
    await prisma.multiplierOutput.deleteMany({ where: { groupId: g.id } });
    await prisma.multiplierGroup.update({
      where: { id: g.id },
      data: { status: "DRAFT", errorMessage: null },
    });
  }

  return { clearedGroups: groups.length, deletedOutputs };
}

// Deletes groups entirely — variation files, output files, and the DB rows
// (cascade removes variations, hooks, outputs). The full "delete group" action.
// Groups currently being worked on (transcribing / queued / rendering) are
// SKIPPED: deleting them mid-flight used to hang the whole bulk-batch pipeline
// (transcribeGroup's status update hit P2025 before reject(), leaving its
// promise pending forever behind the isBulkProcessing lock).
export async function deleteGroups(groupIds: string[]): Promise<{ deletedGroups: number; skippedBusy: number }> {
  const groups = await prisma.multiplierGroup.findMany({
    where: { id: { in: groupIds } },
    include: {
      variations: { select: { videoRef: true } },
      outputs: { select: { outputRef: true } },
    },
  });

  const busy = (g: (typeof groups)[number]) =>
    g.transcriptStatus === "TRANSCRIBING" || g.status === "QUEUED" || g.status === "RENDERING";
  const deletable = groups.filter((g) => !busy(g));

  for (const g of deletable) {
    for (const v of g.variations) deleteLocalUpload(v.videoRef);
    for (const o of g.outputs) deleteLocalUpload(o.outputRef);
    await prisma.multiplierGroup.delete({ where: { id: g.id } });
  }

  return { deletedGroups: deletable.length, skippedBusy: groups.length - deletable.length };
}
