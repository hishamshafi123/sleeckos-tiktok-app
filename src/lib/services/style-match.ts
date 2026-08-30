/**
 * Style Match — recreate a caption style from a reference video.
 *
 * An admin uploads a short clip whose caption style they like. Gemini watches
 * a trimmed/downscaled cut (or 8 sampled frames when the cut is too large for
 * inline upload) and answers with the SAME draft JSON the describe-mode
 * pipeline uses (layer stack + base params), plus one extra top-level
 * `fontGuess` naming the font it believes the reference actually uses. The
 * guess is resolved against Google Fonts via installGoogleFont() — exact
 * family only, never a substitute — and when it installs, the draft's text
 * layers are rewritten to the installed family. The draft is then persisted
 * through the shared persistAiDraft() tail and flows through the existing
 * validate → publish → fork pipeline unchanged.
 *
 * Gemini access is injectable (deps.callGemini) so fixtures never touch the
 * network; the default client mirrors style-lab.ts (GEMINI_API_KEY,
 * gemini-2.5-flash, fence-stripping).
 */

import { GoogleGenAI } from "@google/genai";
import { execFile } from "child_process";
import { promisify } from "util";
import os from "os";
import path from "path";
import fs from "fs";
import {
  draftLayerModelPromptSection,
  persistAiDraft,
  validateAiDraftJson,
  type DecoratedTemplate,
  type StyleMatchNote,
} from "./style-lab";
import {
  installGoogleFont,
  type MergedFontManifestEntry,
} from "./custom-fonts";
import {
  getCachedRemotionBundleLocation,
  invalidateRemotionBundleCache,
} from "../remotion-bundle";
import type { StyleFamily } from "../style-lab/schema";
import type { StyleLayer } from "../style-lab/layers";

const execFileAsync = promisify(execFile);

/** Reference clips are trimmed to this before being sent to Gemini. */
export const STYLE_MATCH_MAX_CLIP_SECONDS = 15;
/** Above this, fall back from inline video to sampled frames. */
export const STYLE_MATCH_INLINE_MAX_BYTES = 18 * 1024 * 1024;
/** Frame fallback: this many evenly-spaced JPEGs across the trim window. */
export const STYLE_MATCH_FRAME_COUNT = 8;

// ─── ffprobe/ffmpeg helpers (pure pieces are fixture-tested) ─────────────────

/** Container duration in seconds via ffprobe. Throws when unprobeable. */
export async function probeDurationSeconds(videoPath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    videoPath,
  ]);
  const seconds = parseFloat(String(stdout).trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`Could not probe duration of ${videoPath}`);
  }
  return seconds;
}

/**
 * Trim window for the Gemini cut: middle-biased — starts 20% in (skipping
 * intros/hooks) and takes up to maxSeconds, clamped so start+duration never
 * exceeds the clip.
 */
export function computeTrimWindow(
  durationSeconds: number,
  maxSeconds: number = STYLE_MATCH_MAX_CLIP_SECONDS,
): { start: number; duration: number } {
  if (durationSeconds <= maxSeconds) return { start: 0, duration: durationSeconds };
  const start = Math.max(0, Math.min(durationSeconds * 0.2, durationSeconds - maxSeconds));
  return { start, duration: maxSeconds };
}

export type PreparedReferenceMedia =
  | { kind: "video"; path: string }
  | { kind: "frames"; paths: string[] };

/**
 * Builds the media Gemini will watch: a ≤15s, 512px-wide, muted h264 mp4 cut
 * of the reference. When the cut still exceeds the inline-upload budget the
 * caller gets 8 evenly-spaced JPEG frames (512px, q:v 4) instead. All outputs
 * land in workDir; the caller owns cleanup.
 */
export async function prepareReferenceMedia(
  videoPath: string,
  workDir: string,
): Promise<PreparedReferenceMedia> {
  const duration = await probeDurationSeconds(videoPath);
  const window = computeTrimWindow(duration);
  const clipPath = path.join(workDir, "reference-cut.mp4");
  await execFileAsync("ffmpeg", [
    "-y",
    "-ss", window.start.toFixed(3),
    "-t", window.duration.toFixed(3),
    "-i", videoPath,
    "-an",
    "-vf", "scale=512:-2",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "28",
    "-movflags", "+faststart",
    clipPath,
  ]);

  if (fs.statSync(clipPath).size <= STYLE_MATCH_INLINE_MAX_BYTES) {
    return { kind: "video", path: clipPath };
  }

  // Frame fallback: ~STYLE_MATCH_FRAME_COUNT frames across the trim window.
  const framesDir = path.join(workDir, "frames");
  fs.mkdirSync(framesDir, { recursive: true });
  const fps = STYLE_MATCH_FRAME_COUNT / window.duration;
  await execFileAsync("ffmpeg", [
    "-y",
    "-ss", window.start.toFixed(3),
    "-t", window.duration.toFixed(3),
    "-i", videoPath,
    "-vf", `scale=512:-2,fps=${fps.toFixed(4)}`,
    "-q:v", "4",
    "-frames:v", String(STYLE_MATCH_FRAME_COUNT),
    path.join(framesDir, "frame_%02d.jpg"),
  ]);
  const paths = fs
    .readdirSync(framesDir)
    .filter((f) => f.endsWith(".jpg"))
    .sort()
    .map((f) => path.join(framesDir, f));
  if (paths.length === 0) {
    throw new Error("Frame extraction produced no images");
  }
  return { kind: "frames", paths };
}

// ─── Prompt + response parsing (pure — fixture-tested) ───────────────────────

/**
 * Style Match vision prompt: observation instructions prepended to the shared
 * layer-model section so the response shape matches describe-mode drafts,
 * plus the extra top-level `fontGuess` field.
 */
export function styleMatchVisionPrompt(
  family: StyleFamily,
  referenceName?: string,
): string {
  return `Watch the attached reference clip${referenceName ? ` ("${referenceName}")` : ""} — it is a short social video with a caption style the user wants to recreate.
Recreate that caption style as a layer stack, sampling from what you SEE:
- Pick the NEAREST font from the installed list below for each text layer —
  NEVER invent a family that is not in the list.
- Separately, add one extra top-level field "fontGuess": string naming the
  ACTUAL font you believe the reference captions use (e.g. "Bebas Neue"),
  even when it is not in the installed list. Your best guess, no explanation.
- Estimate fontWeight and fontSize for a 720x1280 canvas (the draft schema's
  canvas), colors as #RRGGBB sampled from the video, and position as
  xPercent/yPercent/widthPercent of the canvas.
- Reproduce stroke (outlineColor/outlineWidth) and shadow
  (shadow/shadowIntensity) when visible; textGradientTo only when the fill is
  clearly a gradient.
- Match the case via textTransform ("uppercase" etc.).
- Karaoke vs line-by-line: bind the main text layer ("lyrics" / "quote") and
  set baseParams.lineMode to "karaoke" ONLY when words highlight one-by-one
  in a different active color (set highlightColor to that color); otherwise
  use "line-by-line" or "word-by-word".
- Entry animation from the observed motion: entryType/easing/entryDurationMs.
  Use staggered delayMs (150–400ms) for multi-layer depth.
- loopType "pulse"/"float" ONLY when the reference clearly loops a subtle
  continuous motion; otherwise "none".
- baseParams.bgColor MUST be "transparent" — this is an overlay style.
- Ignore creator watermarks/logos — do NOT recreate them as layers.

${draftLayerModelPromptSection(family)}`;
}

export interface ParsedStyleMatchResponse {
  /** The model's raw draft JSON (fontGuess stripped). */
  draft: unknown;
  /** The actual-font guess, or null when absent/empty. */
  fontGuess: string | null;
}

/**
 * Parses a Gemini Style Match response: strips markdown fences, parses JSON,
 * removes the extra top-level fontGuess so the remainder can go straight into
 * validateAiDraftJson. Throws when the text is not parseable JSON.
 */
export function parseStyleMatchResponse(text: string): ParsedStyleMatchResponse {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const parsed = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("response is not a JSON object");
  }
  const fontGuess =
    typeof parsed.fontGuess === "string" && parsed.fontGuess.trim()
      ? parsed.fontGuess.trim().slice(0, 80)
      : null;
  delete parsed.fontGuess;
  return { draft: parsed, fontGuess };
}

/**
 * Builds the provenance note stored in the draft payload. installed=true when
 * the guess resolved on Google Fonts; otherwise nearestFont records the
 * bundled font the draft kept.
 */
export function styleMatchFontNote(opts: {
  fontGuess: string;
  installedFont: string | null;
  nearestFont: string | null;
  referenceName?: string;
}): StyleMatchNote {
  return {
    guessedFont: opts.fontGuess,
    fontInstalled: opts.installedFont !== null,
    ...(opts.installedFont ? { installedFont: opts.installedFont } : {}),
    ...(!opts.installedFont && opts.nearestFont ? { nearestFont: opts.nearestFont } : {}),
    ...(opts.referenceName ? { referenceName: opts.referenceName } : {}),
  };
}

/** Nearest value in pool to target (pool is ascending, non-empty). */
function nearestInPool(pool: number[], target: number): number {
  return pool.reduce((best, w) => (Math.abs(w - target) < Math.abs(best - target) ? w : best));
}

/**
 * Rewrites text layers to an installed custom font: family swap + weight snap
 * to the weights the family actually ships. Only layers that name a font are
 * touched (untyped layers keep the template default).
 */
export function applyInstalledFontToLayers(
  layers: StyleLayer[],
  installed: MergedFontManifestEntry,
): void {
  const pool = installed.weights.length > 0 ? installed.weights : [400];
  for (const layer of layers) {
    if (layer.type !== "text" || !layer.fontFamily) continue;
    layer.fontFamily = installed.family;
    layer.fontWeight = nearestInPool(pool, layer.fontWeight ?? 400);
  }
}

/**
 * The Remotion bundle symlinks public/ (see remotion-bundle.ts), so a font
 * installed after bundling is normally visible through staticFile() already.
 * Safety net: when a cached bundle exists and the font directory is NOT
 * reachable inside it (e.g. a copied bundle), drop the cache so the next
 * render re-bundles.
 */
export function ensureBundleSeesFont(slug: string): void {
  const bundleLoc = getCachedRemotionBundleLocation();
  if (!bundleLoc) return; // nothing cached — first render bundles fresh
  if (!fs.existsSync(path.join(bundleLoc, "fonts", "custom", slug))) {
    invalidateRemotionBundleCache();
  }
}

// ─── Gemini ──────────────────────────────────────────────────────────────────

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

async function callGeminiVision(apiKey: string, parts: GeminiPart[]): Promise<string> {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction:
        "You are a video caption style analyst. You watch a reference clip and translate its caption style into a concrete JSON layer-stack design for a Remotion text-overlay template. You output ONLY valid JSON — no markdown, no commentary.",
    },
  });
  return response.text || "";
}

export interface StyleMatchDeps {
  /** Injectable for tests — defaults to the real Gemini vision call. */
  callGemini?: (parts: GeminiPart[]) => Promise<string>;
  /** Injectable for tests — defaults to installGoogleFont. */
  installFont?: (familyName: string) => Promise<MergedFontManifestEntry | null>;
}

// ─── Main entry ──────────────────────────────────────────────────────────────

/**
 * Generates a Style Lab AI draft from a reference video: prep a Gemini-sized
 * cut (or frames), vision prompt → parse/strip fontGuess → strict
 * validateAiDraftJson (one retry with the error fed back) → optionally
 * install the guessed Google Font and rewrite the draft's fonts → persist via
 * the shared persistAiDraft tail (tagged "style-match", StyleMatchNote in the
 * payload). The draft then flows through validate → publish → fork unchanged.
 */
export async function generateDraftFromReferenceVideo(opts: {
  videoPath: string;
  family: StyleFamily;
  referenceName?: string;
  createdBy?: string;
}, deps?: StyleMatchDeps): Promise<DecoratedTemplate> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey && !deps?.callGemini) {
    throw new Error("GEMINI_API_KEY environment variable is missing");
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "style-match-"));
  try {
    const media = await prepareReferenceMedia(opts.videoPath, workDir);
    const mediaParts: GeminiPart[] =
      media.kind === "video"
        ? [
            {
              inlineData: {
                mimeType: "video/mp4",
                data: fs.readFileSync(media.path).toString("base64"),
              },
            },
          ]
        : media.paths.map((p) => ({
            inlineData: {
              mimeType: "image/jpeg",
              data: fs.readFileSync(p).toString("base64"),
            },
          }));

    const callGemini =
      deps?.callGemini ?? ((parts: GeminiPart[]) => callGeminiVision(apiKey!, parts));
    const basePrompt = styleMatchVisionPrompt(opts.family, opts.referenceName);
    let lastError = "";
    let draft: ReturnType<typeof validateAiDraftJson> | null = null;
    let fontGuess: string | null = null;

    for (let attempt = 0; attempt < 2 && !draft; attempt++) {
      const prompt = lastError
        ? `${basePrompt}\n\nYour previous answer was rejected: ${lastError}\nReturn a corrected JSON object only.`
        : basePrompt;
      const text = await callGemini([...mediaParts, { text: prompt }]);
      let parsed: ParsedStyleMatchResponse;
      try {
        parsed = parseStyleMatchResponse(text);
      } catch {
        lastError = "response was not parseable JSON";
        continue;
      }
      if (parsed.fontGuess) fontGuess = parsed.fontGuess;
      try {
        draft = validateAiDraftJson(parsed.draft, opts.family);
      } catch (err) {
        lastError = err instanceof Error ? err.message : "invalid draft";
      }
    }
    if (!draft) {
      throw new Error(`Style Match draft generation failed validation: ${lastError}`);
    }

    // Font: try to install the ACTUAL font Gemini believes the clip uses.
    // installGoogleFont never substitutes — null means "not on Google Fonts"
    // and the draft keeps its nearest bundled match.
    let note: StyleMatchNote | undefined;
    if (fontGuess) {
      const nearestFont =
        draft.layers.find((l) => l.type === "text" && l.visible && l.fontFamily)?.fontFamily ??
        null;
      const installFont = deps?.installFont ?? installGoogleFont;
      let installed: MergedFontManifestEntry | null = null;
      try {
        installed = await installFont(fontGuess);
      } catch (err) {
        console.warn(`[Style Match] Font install failed for "${fontGuess}":`, err);
      }
      if (installed) {
        applyInstalledFontToLayers(draft.layers, installed);
        ensureBundleSeesFont(installed.slug);
      }
      note = styleMatchFontNote({
        fontGuess,
        installedFont: installed?.family ?? null,
        nearestFont,
        ...(opts.referenceName ? { referenceName: opts.referenceName } : {}),
      });
    }

    return await persistAiDraft(
      draft,
      opts.family,
      opts.createdBy,
      ["style-match"],
      note ? { styleMatch: note } : undefined,
    );
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
