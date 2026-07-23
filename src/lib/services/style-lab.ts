/**
 * Style Lab service — base templates, saved styles, test renders, AI variants.
 *
 * Thin layer over Prisma + the Remotion renderer. Param schemas live in
 * src/lib/style-lab/schema.ts (client-safe); the two base compositions are
 * registered as "lyric-caption" / "quote-card" in src/remotion/index.ts.
 */

import prisma from "@/lib/db";
import { GoogleGenAI } from "@google/genai";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import { listFonts } from "../fonts";
import {
  ALL_STYLE_LAB_TEMPLATES,
  LYRIC_TEMPLATE_KEY,
  QUOTE_TEMPLATE_KEY,
  SAMPLE_LYRIC_LINES,
  SAMPLE_QUOTE,
  coerceParams,
  defaultParams,
  familyForTemplate,
  schemaForTemplate,
  type StyleFamily,
  type StyleParams,
} from "../style-lab/schema";
import { STYLE_LAB_PRESETS } from "../style-lab/presets";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "style-lab");

// ─── Templates ───────────────────────────────────────────────────────────────

/**
 * Idempotently registers every Style Lab template (base + brat + imported
 * collection) as StyleTemplate rows (engine "remotion", isBase). Called by
 * the seed script and lazily by GET /api/style-lab/templates so the page
 * works before the seed runs.
 */
export async function seedStyleLabTemplates(createdBy?: string) {
  for (const tpl of ALL_STYLE_LAB_TEMPLATES) {
    const source = tpl.source ?? "builtin";
    const tags = tpl.tags ?? ["style-lab", "base", tpl.family];
    await prisma.styleTemplate.upsert({
      where: { key: tpl.key },
      update: {
        name: tpl.name,
        engine: tpl.engine,
        paramSchema: JSON.stringify(tpl.schema),
        isBase: true,
        source,
        status: "published",
        tags,
      },
      create: {
        key: tpl.key,
        name: tpl.name,
        engine: tpl.engine,
        paramSchema: JSON.stringify(tpl.schema),
        isBase: true,
        source,
        status: "published",
        tags,
        createdBy,
      },
    });
  }
}

/** Deterministic asset paths for a template's gallery thumbnail/preview. */
export function templateAssetUrls(templateKey: string) {
  return {
    thumbnail: `/uploads/style-lab/tpl_${templateKey}.png`,
    preview: `/uploads/style-lab/tpl_${templateKey}_preview.webm`,
  };
}

function previewUrlIfRendered(templateKey: string): string | null {
  const file = path.join(UPLOAD_DIR, `tpl_${templateKey}_preview.webm`);
  return fs.existsSync(file) ? templateAssetUrls(templateKey).preview : null;
}

/**
 * Gallery payload: all published template rows enriched with family,
 * defaultParams (from the code registry — the row's schema defaults) and
 * the hover-preview URL when the seed script has rendered one.
 */
export async function getStyleLabTemplates() {
  await seedStyleLabTemplates();
  const rows = await prisma.styleTemplate.findMany({
    where: { isBase: true },
    orderBy: [{ source: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((row) => {
    const meta = ALL_STYLE_LAB_TEMPLATES.find((t) => t.key === row.key);
    return {
      ...row,
      family: meta?.family ?? (row.key === QUOTE_TEMPLATE_KEY ? "quote" : "lyric"),
      defaultParams: meta ? defaultParams(meta.schema) : {},
      previewUrl: previewUrlIfRendered(row.key),
    };
  });
}

// ─── Saved styles ────────────────────────────────────────────────────────────

/** Parse SavedStyle.params tolerating the legacy double-JSON encoding. */
export function parseStyleParams(raw: unknown): StyleParams {
  let v: any = raw;
  for (let i = 0; i < 2 && typeof v === "string"; i++) {
    try {
      v = JSON.parse(v);
    } catch {
      return {};
    }
  }
  return v && typeof v === "object" ? v : {};
}

function withParsedParams<T extends { params: unknown }>(row: T): T & { params: StyleParams } {
  return { ...row, params: parseStyleParams(row.params) };
}

const LAB_TEMPLATE_KEYS = ALL_STYLE_LAB_TEMPLATES.map((t) => t.key);

/**
 * Idempotently seeds the starter saved-style presets (Brat, Spotify Card, …).
 * Called lazily by listSavedStyles so every environment gets a working
 * library without a manual seed run.
 */
export async function seedStyleLabPresets(createdBy?: string) {
  await seedStyleLabTemplates(createdBy);
  for (const preset of STYLE_LAB_PRESETS) {
    const schema = schemaForTemplate(preset.templateKey);
    if (!schema) continue;
    const params = {
      ...coerceParams(schema, {}),
      ...coerceParams(schema, preset.params, { partial: true }),
    };
    const existing = await prisma.savedStyle.findFirst({
      where: { templateKey: preset.templateKey, name: preset.name },
    });
    if (existing) {
      await prisma.savedStyle.update({
        where: { id: existing.id },
        data: { params: JSON.stringify(params), family: preset.family, tags: preset.tags },
      });
    } else {
      await prisma.savedStyle.create({
        data: {
          templateKey: preset.templateKey,
          name: preset.name,
          params: JSON.stringify(params),
          family: preset.family,
          tags: preset.tags,
          createdBy: createdBy ?? null,
        },
      });
    }
  }
}

let presetsSeeded = false;

/**
 * Styles managed by the Style Lab — i.e. presets of the two base templates.
 * Legacy style-studio presets keep living in the old studio until cleanup.
 */
export async function listSavedStyles(family?: StyleFamily) {
  if (!presetsSeeded) {
    presetsSeeded = true; // guard before await — concurrent lists seed once
    try {
      const count = await prisma.savedStyle.count({ where: { templateKey: { in: LAB_TEMPLATE_KEYS } } });
      if (count === 0) await seedStyleLabPresets();
    } catch (err) {
      console.error("[Style Lab] Lazy preset seed failed:", err);
    }
  }
  const rows = await prisma.savedStyle.findMany({
    where: {
      templateKey: { in: LAB_TEMPLATE_KEYS },
      ...(family ? { family } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(withParsedParams);
}

function assertLabTemplate(templateKey: string) {
  const schema = schemaForTemplate(templateKey);
  if (!schema) {
    throw new Error(`Unknown Style Lab template "${templateKey}"`);
  }
  return schema;
}

export async function createSavedStyle(data: {
  templateKey: string;
  name: string;
  params: StyleParams;
  tags?: string[];
  thumbnail?: string;
  createdBy?: string;
}) {
  const schema = assertLabTemplate(data.templateKey);
  const coerced = coerceParams(schema, data.params); // full; rejects unknown keys
  const row = await prisma.savedStyle.create({
    data: {
      templateKey: data.templateKey,
      name: data.name.trim(),
      params: JSON.stringify(coerced),
      family: familyForTemplate(data.templateKey) ?? "lyric",
      tags: data.tags ?? [],
      thumbnail: data.thumbnail,
      createdBy: data.createdBy,
    },
  });
  return withParsedParams(row);
}

export async function getSavedStyle(id: string) {
  const row = await prisma.savedStyle.findUnique({ where: { id } });
  return row ? withParsedParams(row) : null;
}

export async function updateSavedStyle(
  id: string,
  data: { name?: string; params?: StyleParams; tags?: string[]; thumbnail?: string | null },
) {
  const existing = await prisma.savedStyle.findUnique({ where: { id } });
  if (!existing) throw new Error("Saved style not found");

  const updateData: any = {};
  if (data.name !== undefined) updateData.name = data.name.trim();
  if (data.tags !== undefined) updateData.tags = data.tags;
  if (data.thumbnail !== undefined) updateData.thumbnail = data.thumbnail;
  if (data.params !== undefined) {
    const schema = assertLabTemplate(existing.templateKey);
    updateData.params = JSON.stringify(coerceParams(schema, data.params));
  }

  const row = await prisma.savedStyle.update({ where: { id }, data: updateData });
  return withParsedParams(row);
}

export async function deleteSavedStyle(id: string) {
  await prisma.savedStyle.delete({ where: { id } });
}

export async function duplicateSavedStyle(id: string, createdBy?: string) {
  const source = await prisma.savedStyle.findUnique({ where: { id } });
  if (!source) throw new Error("Saved style not found");
  const row = await prisma.savedStyle.create({
    data: {
      templateKey: source.templateKey,
      name: `${source.name} (copy)`.slice(0, 120),
      params: source.params,
      thumbnail: source.thumbnail,
      family: source.family,
      tags: source.tags,
      createdBy: createdBy ?? source.createdBy,
    },
  });
  return withParsedParams(row);
}

// ─── Fonts (for the control panel) ───────────────────────────────────────────

export function getFontManifest() {
  return listFonts().map((f) => ({
    family: f.family,
    weights: f.weights,
    italics: f.italics,
    license: f.license,
  }));
}

// ─── Test renders (still + short clip), concurrency 1 ────────────────────────

let cachedBundleLocation: string | null = null;

async function getBundle(): Promise<string> {
  if (cachedBundleLocation && fs.existsSync(cachedBundleLocation)) {
    return cachedBundleLocation;
  }
  const entryPoint = path.join(process.cwd(), "src", "remotion", "index.ts");
  console.log(`[Style Lab] Bundling Remotion entry point: ${entryPoint}`);
  cachedBundleLocation = await bundle(entryPoint);
  return cachedBundleLocation;
}

// In-process serial queue — one render at a time, like the style-studio worker.
let renderQueue: Promise<unknown> = Promise.resolve();

function enqueueRender<T>(job: () => Promise<T>): Promise<T> {
  const run = renderQueue.then(job);
  renderQueue = run.catch(() => undefined);
  return run;
}

export type TestRenderFormat = "still" | "video";

// ─── Alpha (transparency) post-render assertions ─────────────────────────────

const execFileAsync = promisify(execFile);

/**
 * WebM alpha is stored as VP8/VP9 BlockAdditional side data — ffprobe reports
 * pix_fmt=yuv420p even for transparent videos, and ffmpeg's native decoders
 * drop the alpha plane. The only honest check: decode a frame with the libvpx
 * decoder, extract the alpha plane, and confirm it is not fully opaque.
 * Returns the minimum alpha value (0..255), or null when no alpha plane
 * could be decoded at all.
 */
async function probeVideoMinAlpha(
  file: string,
  codec: "vp8" | "vp9",
): Promise<number | null> {
  try {
    const decoder = codec === "vp9" ? "libvpx-vp9" : "libvpx";
    const { stdout } = await execFileAsync(
      "ffmpeg",
      [
        "-v", "error",
        "-c:v", decoder,
        "-i", file,
        "-vf", "alphaextract",
        "-frames:v", "1",
        "-f", "rawvideo",
        "-pix_fmt", "gray",
        "-",
      ],
      { encoding: "buffer", maxBuffer: 128 * 1024 * 1024 } as any,
    );
    const buf = stdout as unknown as Buffer;
    if (!buf || buf.length === 0) return null;
    let min = 255;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] < min) {
        min = buf[i];
        if (min === 0) break;
      }
    }
    return min;
  } catch {
    return null; // alphaextract fails when the stream has no alpha plane
  }
}

/** Reads the PNG IHDR color type: 4 (gray+alpha) / 6 (RGBA) = has alpha. */
function pngHasAlphaChannel(file: string): boolean | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, "r");
    const header = Buffer.alloc(26);
    fs.readSync(fd, header, 0, 26, 0);
    if (header.readUInt32BE(0) !== 0x89504e47) return null; // not a PNG
    const colorType = header[25];
    return colorType === 4 || colorType === 6;
  } catch {
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/**
 * Transparency invariant: a style whose bg is transparent must produce an
 * output with a real alpha channel. Throws (fails the render loudly) when
 * the encoder silently dropped alpha.
 */
async function assertAlphaOutput(
  file: string,
  kind: TestRenderFormat,
  styleName: string,
): Promise<void> {
  if (kind === "video") {
    const minAlpha = await probeVideoMinAlpha(file, "vp9");
    if (minAlpha === null) {
      throw new Error(
        `[Style Lab] Transparency assertion failed: overlay style "${styleName}" ` +
        `rendered a video with no decodable alpha plane: ${file}`,
      );
    }
    if (minAlpha >= 250) {
      throw new Error(
        `[Style Lab] Transparency assertion failed: overlay style "${styleName}" ` +
        `rendered a fully opaque video (min alpha=${minAlpha}): ${file}`,
      );
    }
    return;
  }
  const hasAlpha = pngHasAlphaChannel(file);
  if (hasAlpha !== true) {
    throw new Error(
      `[Style Lab] Transparency assertion failed: overlay style "${styleName}" ` +
      `rendered a still without an alpha channel: ${file}`,
    );
  }
}

export async function renderTestSample(opts: {
  templateKey: string;
  params: StyleParams;
  format: TestRenderFormat;
}): Promise<{ url: string }> {
  return enqueueRender(async () => {
    const schema = assertLabTemplate(opts.templateKey);
    const coerced = coerceParams(schema, opts.params);

    // Every comp gets the full sample-content bag; each reads only the
    // props it understands (lines / quoteText+author / text via params).
    const inputProps: StyleParams = {
      ...coerced,
      lines: SAMPLE_LYRIC_LINES,
      quoteText: SAMPLE_QUOTE.quoteText,
      author: SAMPLE_QUOTE.author,
    };

    const bundleLocation = await getBundle();
    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: opts.templateKey,
      inputProps,
    });

    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Overlay styles (transparent bg) must keep alpha end-to-end.
    const isOverlay = coerced.bgColor === "transparent";
    const styleLabel = `${opts.templateKey}`;

    if (opts.format === "still") {
      const fileName = `still_${stamp}.png`;
      const outFile = path.join(UPLOAD_DIR, fileName);
      // Render mid-composition so entry animations have completed.
      const frame = Math.max(0, Math.floor(composition.durationInFrames / 2));
      await renderStill({
        composition,
        serveUrl: bundleLocation,
        output: outFile,
        inputProps,
        frame,
        browserExecutable: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      });
      if (isOverlay) await assertAlphaOutput(outFile, "still", styleLabel);
      return { url: `/uploads/style-lab/${fileName}` };
    }

    // ~3s clip (or the full comp when shorter).
    const frames = Math.min(composition.durationInFrames, 90);

    if (isOverlay) {
      // WebM VP9 + PNG frames keeps the alpha channel (h264 mp4 destroys it).
      const fileName = `test_${stamp}.webm`;
      const outFile = path.join(UPLOAD_DIR, fileName);
      await renderMedia({
        composition,
        serveUrl: bundleLocation,
        outputLocation: outFile,
        inputProps,
        codec: "vp9",
        imageFormat: "png",
        pixelFormat: "yuva420p",
        frameRange: [0, frames - 1],
        browserExecutable: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      });
      await assertAlphaOutput(outFile, "video", styleLabel);
      return { url: `/uploads/style-lab/${fileName}` };
    }

    const fileName = `test_${stamp}.mp4`;
    const outFile = path.join(UPLOAD_DIR, fileName);
    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      outputLocation: outFile,
      inputProps,
      codec: "h264",
      frameRange: [0, frames - 1],
      browserExecutable: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    });
    return { url: `/uploads/style-lab/${fileName}` };
  });
}

/**
 * Renders a still for a saved style and stores it as its thumbnail.
 * Best-effort: failures are logged and swallowed (style stays usable).
 */
export async function generateSavedStyleThumbnail(id: string): Promise<string | null> {
  const row = await prisma.savedStyle.findUnique({ where: { id } });
  if (!row || !LAB_TEMPLATE_KEYS.includes(row.templateKey)) return null;
  try {
    const { url } = await renderTestSample({
      templateKey: row.templateKey,
      params: parseStyleParams(row.params),
      format: "still",
    });
    await prisma.savedStyle.update({ where: { id }, data: { thumbnail: url } });
    return url;
  } catch (err) {
    console.warn(`[Style Lab] Thumbnail render failed for style ${id}:`, err);
    return null;
  }
}

// ─── Template gallery assets (deterministic names, seed-time rendering) ─────

const TEMPLATE_PREVIEW_SECONDS = 2.5;

/**
 * Renders a template's gallery assets with its schema defaults:
 *   - tpl_<key>.png          still (mid-clip frame) → StyleTemplate.thumbnail
 *   - tpl_<key>_preview.webm ~2.5s loop for the gallery hover preview
 * Deterministic filenames: re-running the seed overwrites in place.
 * Throws on failure (the seed script decides whether to continue).
 */
export async function renderTemplateAssets(
  templateKey: string,
): Promise<{ thumbnail: string; preview: string }> {
  return enqueueRender(async () => {
    const schema = assertLabTemplate(templateKey);
    const params = defaultParams(schema); // per-template defaults baked into the schema
    const inputProps: StyleParams = {
      ...params,
      lines: SAMPLE_LYRIC_LINES,
      quoteText: SAMPLE_QUOTE.quoteText,
      author: SAMPLE_QUOTE.author,
    };

    const bundleLocation = await getBundle();
    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: templateKey,
      inputProps,
    });

    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const urls = templateAssetUrls(templateKey);
    const thumbFile = path.join(UPLOAD_DIR, `tpl_${templateKey}.png`);
    const previewFile = path.join(UPLOAD_DIR, `tpl_${templateKey}_preview.webm`);
    const isOverlay = params.bgColor === "transparent";
    const browserExecutable = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;

    // Still: mid-clip so entry animations have completed.
    const frame = Math.max(0, Math.floor(composition.durationInFrames / 2));
    await renderStill({
      composition,
      serveUrl: bundleLocation,
      output: thumbFile,
      inputProps,
      frame,
      browserExecutable,
    });
    if (isOverlay) await assertAlphaOutput(thumbFile, "still", templateKey);

    // Hover preview: ~2.5s webm (VP9; alpha pixel format for overlays).
    const frames = Math.min(
      composition.durationInFrames,
      Math.max(1, Math.round(TEMPLATE_PREVIEW_SECONDS * composition.fps)),
    );
    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      outputLocation: previewFile,
      inputProps,
      codec: "vp9",
      imageFormat: "png",
      ...(isOverlay ? { pixelFormat: "yuva420p" as const } : {}),
      frameRange: [0, frames - 1],
      browserExecutable,
    });
    if (isOverlay) await assertAlphaOutput(previewFile, "video", templateKey);

    await prisma.styleTemplate.update({
      where: { key: templateKey },
      data: { thumbnail: urls.thumbnail },
    });
    return { thumbnail: urls.thumbnail, preview: urls.preview };
  });
}

// ─── AI variant authoring (v1: param-set variants of a base template) ────────

function schemaSummaryForPrompt(templateKey: string): string {
  const schema = assertLabTemplate(templateKey);
  const fonts = listFonts()
    .map((f) => `${f.family} (weights: ${f.weights.join("/")}${f.italics.length ? `, italics: ${f.italics.join("/")}` : ", no italics"})`)
    .join("; ");

  const fields = schema
    .map((f) => {
      const bits = [`"${f.key}" (${f.type}`];
      if (f.min !== undefined || f.max !== undefined) bits.push(`range ${f.min}–${f.max}`);
      if (f.options) bits.push(`one of: ${f.options.map((o) => o.value).join(", ")}`);
      bits.push(`default ${JSON.stringify(f.defaultValue)}`);
      return `- ${bits.join("; ")}) — ${f.label}`;
    })
    .join("\n");

  return `PARAMETERS (use ONLY these keys):
${fields}

Available fontFamily values: ${fonts}
Rules: colors are #RRGGBB hex; fontWeight must be one of the chosen family's weights; respect ranges and enums exactly.`;
}

export async function generateAiVariant(opts: {
  description: string;
  family: StyleFamily;
  createdBy?: string;
}) {
  const description = opts.description.trim();
  if (!description) throw new Error("Description is required");

  const templateKey = opts.family === "quote" ? QUOTE_TEMPLATE_KEY : LYRIC_TEMPLATE_KEY;
  const schema = assertLabTemplate(templateKey);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY environment variable is missing");

  const systemInstruction = `You are a video caption style designer. You translate a short creative direction into a concrete JSON parameter set for a Remotion text-overlay template. You output ONLY valid JSON — no markdown, no commentary.`;

  const prompt = `Create a ${opts.family === "quote" ? "quote card" : "lyric caption"} style matching this creative direction:
"${description}"

${schemaSummaryForPrompt(templateKey)}

Respond with a single raw JSON object mapping param keys to values. Include only keys you want to change from defaults; unknown keys are rejected. Do not wrap in \`\`\`json fences.`;

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: { systemInstruction },
  });

  let text = (response.text || "").trim();
  // Tolerate accidental markdown fences.
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  let parsed: StyleParams;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("AI returned unparseable JSON — please retry");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AI returned an invalid param object — please retry");
  }

  // Validate + coerce (throws on unknown keys), then fill gaps with defaults.
  const partial = coerceParams(schema, parsed, { partial: true });
  const params = { ...defaultParams(schema), ...partial };

  const name = description.length > 60 ? `${description.slice(0, 57)}…` : description;

  const style = await createSavedStyle({
    templateKey,
    name,
    params,
    tags: ["ai"],
    createdBy: opts.createdBy,
  });

  // Best-effort thumbnail, rendered in the background (first render bundles
  // Remotion, which can exceed an HTTP timeout — don't block the response).
  void generateSavedStyleThumbnail(style.id).catch(() => undefined);
  return style;
}
