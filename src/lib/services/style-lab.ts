/**
 * Style Lab service — base templates, saved styles, test renders, AI variants.
 *
 * Thin layer over Prisma + the Remotion renderer. Param schemas live in
 * src/lib/style-lab/schema.ts (client-safe); the two base compositions are
 * registered as "lyric-caption" / "quote-card" in src/remotion/index.ts.
 */

import prisma from "@/lib/db";
import { GoogleGenAI } from "@google/genai";
import { Prisma } from "@prisma/client";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { execFile } from "child_process";
import { promisify } from "util";
import { createHash } from "crypto";
import path from "path";
import fs from "fs";
import { listFonts } from "../fonts";
import {
  ALL_STYLE_LAB_TEMPLATES,
  LYRIC_PARAM_SCHEMA,
  LYRIC_TEMPLATE_KEY,
  QUOTE_PARAM_SCHEMA,
  QUOTE_TEMPLATE_KEY,
  SAMPLE_LYRIC_LINES,
  SAMPLE_QUOTE,
  coerceParams,
  defaultParams,
  familyForTemplate,
  isAiTemplateKey,
  schemaForTemplate,
  type ParamField,
  type StyleFamily,
  type StyleParams,
} from "../style-lab/schema";
import {
  LAYERED_TEMPLATE_KEY,
  coerceLayers,
  layersToJson,
  type StyleLayer,
} from "../style-lab/layers";
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
 * Gallery row decorator: builtin/imported rows resolve family + defaults from
 * the code registry; AI draft rows (source "ai_draft") carry everything in
 * their paramSchema JSON payload ({ fields, layers, defaultParams, family,
 * validation? }).
 */
function decorateTemplateRow(row: any) {
  const meta = ALL_STYLE_LAB_TEMPLATES.find((t) => t.key === row.key);
  if (meta) {
    return {
      ...row,
      family: meta.family,
      defaultParams: defaultParams(meta.schema),
      layers: null,
      validation: null,
      previewUrl: previewUrlIfRendered(row.key),
    };
  }
  const payload = parseDraftTemplatePayload(row.paramSchema);
  if (payload) {
    return {
      ...row,
      family: payload.family,
      defaultParams: payload.defaultParams,
      layers: payload.layers,
      validation: payload.validation ?? null,
      previewUrl: previewUrlIfRendered(row.key),
    };
  }
  return {
    ...row,
    family: row.key === QUOTE_TEMPLATE_KEY ? "quote" : "lyric",
    defaultParams: {},
    layers: null,
    validation: null,
    previewUrl: previewUrlIfRendered(row.key),
  };
}

/**
 * Gallery payload: all published template rows enriched with family,
 * defaultParams (from the code registry — the row's schema defaults) and
 * the hover-preview URL when the seed script has rendered one. AI draft rows
 * (status "draft") are included so the gallery can render the drafts shelf.
 */
export async function getStyleLabTemplates() {
  await seedStyleLabTemplates();
  const rows = await prisma.styleTemplate.findMany({
    where: { isBase: true },
    orderBy: [{ source: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(decorateTemplateRow);
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

/**
 * Parse SavedStyle.layers (Json?). null = legacy single-layer style (the
 * flat params object is the main text layer). Non-empty array = layered
 * style, rendered via the layered-style composition.
 */
export function parseStyleLayers(raw: unknown): StyleLayer[] | null {
  if (raw === null || raw === undefined) return null;
  const layers = coerceLayers(raw);
  return layers.length > 0 ? layers : null;
}

function withParsedParams<T extends { params: unknown; layers?: unknown }>(
  row: T,
): T & { params: StyleParams; layers: StyleLayer[] | null } {
  return { ...row, params: parseStyleParams(row.params), layers: parseStyleLayers(row.layers) };
}

const LAB_TEMPLATE_KEYS = ALL_STYLE_LAB_TEMPLATES.map((t) => t.key);
/** Saved styles may also be layered stacks (templateKey "layered-style"),
 * e.g. forks of published AI templates. */
const SAVED_STYLE_TEMPLATE_KEYS = [...LAB_TEMPLATE_KEYS, LAYERED_TEMPLATE_KEY];

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
    // Match by NAME across lab templates (not just templateKey): presets can
    // move between templates (e.g. Brat moved lyric-caption → brat-lyrics),
    // and the old row must migrate instead of duplicating.
    const existing = await prisma.savedStyle.findFirst({
      where: { name: preset.name, templateKey: { in: LAB_TEMPLATE_KEYS } },
      orderBy: { createdAt: "asc" }, // migrate the oldest row deterministically
    });
    if (existing) {
      await prisma.savedStyle.update({
        where: { id: existing.id },
        data: {
          templateKey: preset.templateKey,
          params: JSON.stringify(params),
          family: preset.family,
          tags: preset.tags,
        },
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
 * Idempotently ensures every published Style Lab template (base + brat +
 * imported collection) has at least one SavedStyle named after the template
 * ("<Template Name>", schema defaults, tags ["preset"]). The Video Factory's
 * style step lists SavedStyle rows — without this, templates that only exist
 * as StyleTemplate rows are invisible there. Skips any template that already
 * has a saved style. AI draft templates are excluded on purpose: they render
 * through the layered-style comp and enter the library at publish time, not
 * as raw template keys.
 */
export async function seedDefaultSavedStyles(createdBy?: string) {
  await seedStyleLabTemplates(createdBy);
  for (const tpl of ALL_STYLE_LAB_TEMPLATES) {
    const existing = await prisma.savedStyle.findFirst({
      where: { templateKey: tpl.key },
    });
    if (existing) continue;
    await prisma.savedStyle.create({
      data: {
        templateKey: tpl.key,
        name: tpl.name,
        params: JSON.stringify(defaultParams(tpl.schema)),
        family: tpl.family,
        tags: ["preset"],
        createdBy: createdBy ?? null,
      },
    });
  }
}

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
      // Default styles for every published template (imported + brat), so
      // the factory sees the full library — runs even when presets exist.
      await seedDefaultSavedStyles();
    } catch (err) {
      console.error("[Style Lab] Lazy preset seed failed:", err);
    }
  }
  const rows = await prisma.savedStyle.findMany({
    where: {
      templateKey: { in: SAVED_STYLE_TEMPLATE_KEYS },
      ...(family ? { family } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(withParsedParams);
}

function assertLabTemplate(templateKey: string) {
  const schema =
    schemaForTemplate(templateKey) ??
    (templateKey === LAYERED_TEMPLATE_KEY ? LYRIC_PARAM_SCHEMA : null);
  if (!schema) {
    throw new Error(`Unknown Style Lab template "${templateKey}"`);
  }
  return schema;
}

/**
 * Schema resolution for render paths (async — AI template keys resolve their
 * fields from the StyleTemplate row's paramSchema payload).
 */
async function resolveSchemaForRender(templateKey: string): Promise<ParamField[]> {
  const sync =
    schemaForTemplate(templateKey) ??
    (templateKey === LAYERED_TEMPLATE_KEY ? LYRIC_PARAM_SCHEMA : null);
  if (sync) return sync;
  if (isAiTemplateKey(templateKey)) {
    const row = await prisma.styleTemplate.findUnique({ where: { key: templateKey } });
    const payload = row ? parseDraftTemplatePayload(row.paramSchema) : null;
    if (payload) return payload.fields;
  }
  throw new Error(`Unknown Style Lab template "${templateKey}"`);
}

/**
 * Save-path resolution. AI template keys (ai_*) are translated to their
 * production-safe shape: the SavedStyle stores templateKey "layered-style"
 * (a registered composition) plus the template's layer stack. Only
 * PUBLISHED AI templates resolve — drafts cannot enter the library.
 */
async function resolveTemplateForSave(templateKey: string): Promise<{
  schema: ParamField[];
  storeKey: string;
  family: StyleFamily;
  defaultLayers: StyleLayer[] | null;
}> {
  const builtin = schemaForTemplate(templateKey);
  if (builtin) {
    return {
      schema: builtin,
      storeKey: templateKey,
      family: familyForTemplate(templateKey) ?? "lyric",
      defaultLayers: null,
    };
  }
  if (templateKey === LAYERED_TEMPLATE_KEY) {
    return { schema: LYRIC_PARAM_SCHEMA, storeKey: templateKey, family: "lyric", defaultLayers: null };
  }
  if (isAiTemplateKey(templateKey)) {
    const row = await prisma.styleTemplate.findUnique({ where: { key: templateKey } });
    const payload =
      row && row.status === "published" ? parseDraftTemplatePayload(row.paramSchema) : null;
    if (!payload) {
      throw new Error(`Template "${templateKey}" is not a published Style Lab template`);
    }
    return {
      schema: payload.fields,
      storeKey: LAYERED_TEMPLATE_KEY,
      family: payload.family,
      defaultLayers: payload.layers,
    };
  }
  throw new Error(`Unknown Style Lab template "${templateKey}"`);
}

export async function createSavedStyle(data: {
  templateKey: string;
  name: string;
  params: StyleParams;
  layers?: unknown; // layer stack (StyleLayer[]) — omitted/null = legacy single-layer
  tags?: string[];
  thumbnail?: string;
  createdBy?: string;
}) {
  const resolved = await resolveTemplateForSave(data.templateKey);
  const coerced = coerceParams(resolved.schema, data.params); // full; rejects unknown keys
  // Explicit layers win; forks of published AI templates inherit the stack.
  const layerSource = data.layers != null ? data.layers : resolved.defaultLayers;
  const layers = layerSource != null ? layersToJson(coerceLayers(layerSource)) : null;
  const row = await prisma.savedStyle.create({
    data: {
      templateKey: resolved.storeKey,
      name: data.name.trim(),
      params: JSON.stringify(coerced),
      ...(layers && layers.length > 0 ? { layers: layers as unknown as Prisma.InputJsonValue } : {}),
      family: resolved.family,
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
  data: {
    name?: string;
    params?: StyleParams;
    layers?: unknown; // StyleLayer[] to set, null to clear (back to legacy single-layer)
    tags?: string[];
    thumbnail?: string | null;
  },
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
  if (data.layers !== undefined) {
    if (data.layers === null) {
      updateData.layers = Prisma.JsonNull;
    } else {
      const layers = layersToJson(coerceLayers(data.layers));
      updateData.layers = layers.length > 0 ? (layers as unknown as Prisma.InputJsonValue) : Prisma.JsonNull;
    }
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
      ...(source.layers != null ? { layers: source.layers as Prisma.InputJsonValue } : {}),
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

import { getRemotionBundle } from "../remotion-bundle";

async function getBundle(): Promise<string> {
  console.log("[Style Lab] Getting shared Remotion bundle");
  return getRemotionBundle();
}

// In-process serial queue — one render at a time, like the style-studio worker.
let renderQueue: Promise<unknown> = Promise.resolve();

function enqueueRender<T>(job: () => Promise<T>): Promise<T> {
  const run = renderQueue.then(job);
  renderQueue = run.catch(() => undefined);
  return run;
}

export type TestRenderFormat = "still" | "video";

/**
 * Content hash for a style render: templateKey + flat params + the FULL
 * layer stack. Layered test-render/thumbnail filenames carry a slice of it
 * so two stacks can never share a stale output.
 */
export function styleOverlayHash(
  templateKey: string,
  params: StyleParams,
  layers: unknown,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ templateKey, params, layers: layers ?? null }))
    .digest("hex");
}

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
  layers?: unknown; // non-empty stack → render via the layered-style comp
  format: TestRenderFormat;
}): Promise<{ url: string }> {
  return enqueueRender(async () => {
    const schema = await resolveSchemaForRender(opts.templateKey);
    const coerced = coerceParams(schema, opts.params);

    const layers = opts.layers != null ? coerceLayers(opts.layers) : null;
    const layered = layers !== null && layers.length > 0;
    const compositionId = layered ? LAYERED_TEMPLATE_KEY : opts.templateKey;
    const hash8 = layered
      ? styleOverlayHash(opts.templateKey, coerced, layers).slice(0, 8)
      : null;

    // Every comp gets the full sample-content bag; each reads only the
    // props it understands (lines / quoteText+author / text via params /
    // the layer stack for layered-style).
    const inputProps: StyleParams = {
      ...coerced,
      lines: SAMPLE_LYRIC_LINES,
      quoteText: SAMPLE_QUOTE.quoteText,
      author: SAMPLE_QUOTE.author,
      ...(layered ? { layers } : {}),
    };

    const bundleLocation = await getBundle();
    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: compositionId,
      inputProps,
    });

    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const tag = hash8 ? `_${hash8}` : "";

    // Overlay styles (transparent bg) must keep alpha end-to-end.
    const isOverlay = coerced.bgColor === "transparent";
    const styleLabel = `${compositionId}`;

    if (opts.format === "still") {
      const fileName = `still_${stamp}${tag}.png`;
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
      const fileName = `test_${stamp}${tag}.webm`;
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

    const fileName = `test_${stamp}${tag}.mp4`;
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
  if (!row || !SAVED_STYLE_TEMPLATE_KEYS.includes(row.templateKey)) return null;
  try {
    const { url } = await renderTestSample({
      templateKey: row.templateKey,
      params: parseStyleParams(row.params),
      layers: parseStyleLayers(row.layers) ?? undefined, // layered styles compose the full stack
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

// ─── AI draft templates (Part 7: describe → layered draft → validate → publish) ─
//
// Deliberately constrained generation: the model returns a LAYER STACK +
// canvas params (never raw component code), so drafts compile by
// construction — they render through the registered layered-style
// composition. All model output is validated against the layer coercers and
// param-schema validators before a StyleTemplate row (source "ai_draft",
// status "draft") is created. Drafts become production-usable only after
// validate (schema + transparency + render) and publish.

export interface DraftValidation {
  schema: boolean;
  transparency: boolean;
  render: boolean;
  /** ISO timestamp of the last fully-successful validation, else null. */
  validatedAt: string | null;
  errors: string[];
}

export interface DraftTemplatePayload {
  fields: ParamField[];
  layers: StyleLayer[];
  defaultParams: StyleParams;
  family: StyleFamily;
  validation?: DraftValidation | null;
}

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * Parses an AI-template row's paramSchema payload. Returns null for
 * non-object schemas (builtin rows store a plain ParamField[] — those are
 * handled by the code registry instead).
 */
export function parseDraftTemplatePayload(raw: unknown): DraftTemplatePayload | null {
  let v: any = raw;
  for (let i = 0; i < 2 && typeof v === "string"; i++) {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  if (!Array.isArray(v.fields) || !Array.isArray(v.layers)) return null;
  return {
    fields: v.fields as ParamField[],
    layers: coerceLayers(v.layers),
    defaultParams: v.defaultParams && typeof v.defaultParams === "object" ? v.defaultParams : {},
    family: v.family === "quote" ? "quote" : "lyric",
    validation: v.validation ?? null,
  };
}

/** Drafts the model can pick values for (canvas / bg / lyric engine / effects). */
const DRAFT_BASE_PARAM_KEYS = [
  "bgColor",
  "aspectRatio",
  "lineMode",
  "linesVisible",
  "timingOffsetMs",
  "pixelate",
  "blur",
  "vignette",
  "grain",
  "noise",
];

function draftBaseSchema(family: StyleFamily): ParamField[] {
  const full = family === "quote" ? QUOTE_PARAM_SCHEMA : LYRIC_PARAM_SCHEMA;
  return full.filter((f) => DRAFT_BASE_PARAM_KEYS.includes(f.key));
}

function draftFullSchema(family: StyleFamily): ParamField[] {
  return family === "quote" ? QUOTE_PARAM_SCHEMA : LYRIC_PARAM_SCHEMA;
}

function slugifyDraftKey(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "style"
  );
}

async function uniqueDraftKey(name: string): Promise<string> {
  const slug = slugifyDraftKey(name);
  for (let i = 0; i < 10; i++) {
    const rand = Math.random().toString(36).slice(2, 8);
    const key = `ai_${slug}_${rand}`;
    const existing = await prisma.styleTemplate.findUnique({ where: { key } });
    if (!existing) return key;
  }
  throw new Error("Could not allocate a unique draft template key");
}

// ─── AI output validation (strict — feeds one retry) ─────────────────────────

const LAYER_TYPES = new Set(["text", "image", "shape"]);
const LAYER_BINDS = new Set(["lyrics", "quote"]);
const LAYER_ENTRY_TYPES = new Set(["fade", "slide-up", "pop", "none"]);
const LAYER_TRANSFORMS = new Set(["none", "uppercase", "lowercase"]);
const LAYER_ALIGNMENTS = new Set(["left", "center", "right"]);

function assertModelColor(value: unknown, label: string) {
  if (value === undefined) return;
  const s = String(value).trim();
  if (s !== "transparent" && !HEX_COLOR_RE.test(s)) {
    throw new Error(`${label} must be "transparent" or a #RRGGBB hex color (got ${JSON.stringify(value)})`);
  }
}

function validateAiDraftJson(parsed: any, family: StyleFamily): {
  name: string;
  tags: string[];
  defaultParams: StyleParams;
  layers: StyleLayer[];
} {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("response is not a JSON object");
  }
  const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
  if (!name) throw new Error('"name" must be a non-empty string');

  const tags: string[] = Array.isArray(parsed.tags)
    ? [...new Set<string>(
        parsed.tags
          .filter((t: any) => typeof t === "string")
          .map((t: string) => t.trim().toLowerCase())
          .filter((t: string) => t.length > 0),
      )].slice(0, 6)
    : [];
  if (!tags.includes("ai")) tags.unshift("ai");

  // baseParams: only the whitelisted canvas/effects keys (coerceParams throws
  // on unknown keys), bgColor strictly valid when present.
  const baseParams = parsed.baseParams ?? {};
  if (typeof baseParams !== "object" || Array.isArray(baseParams)) {
    throw new Error('"baseParams" must be an object');
  }
  const coercedBase = coerceParams(draftBaseSchema(family), baseParams, { partial: true });
  assertModelColor(baseParams.bgColor, "baseParams.bgColor");

  // layers: strict shape checks BEFORE the tolerant coercer so the model gets
  // actionable feedback instead of silent defaulting.
  const rawLayers = parsed.layers;
  if (!Array.isArray(rawLayers) || rawLayers.length === 0) {
    throw new Error('"layers" must be a non-empty array');
  }
  if (rawLayers.length > 6) throw new Error('"layers" supports at most 6 entries');
  const fonts = listFonts();
  rawLayers.forEach((raw: any, i: number) => {
    const where = `layers[${i}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`${where} must be an object`);
    }
    if (raw.type !== undefined && !LAYER_TYPES.has(raw.type)) {
      throw new Error(`${where}.type must be one of text/image/shape`);
    }
    const type = raw.type ?? "text";
    if (raw.bind !== undefined && raw.bind !== null && !LAYER_BINDS.has(raw.bind)) {
      throw new Error(`${where}.bind must be "lyrics", "quote" or null`);
    }
    if (raw.entryType !== undefined && !LAYER_ENTRY_TYPES.has(raw.entryType)) {
      throw new Error(`${where}.entryType must be one of fade/slide-up/pop/none`);
    }
    if (raw.textTransform !== undefined && !LAYER_TRANSFORMS.has(raw.textTransform)) {
      throw new Error(`${where}.textTransform must be one of none/uppercase/lowercase`);
    }
    if (raw.alignment !== undefined && !LAYER_ALIGNMENTS.has(raw.alignment)) {
      throw new Error(`${where}.alignment must be one of left/center/right`);
    }
    if (type === "text" && raw.fontFamily !== undefined) {
      const ok = fonts.some((f) => f.family.toLowerCase() === String(raw.fontFamily).toLowerCase());
      if (!ok) throw new Error(`${where}.fontFamily "${raw.fontFamily}" is not an available font`);
    }
    assertModelColor(raw.textColor, `${where}.textColor`);
    assertModelColor(raw.highlightColor, `${where}.highlightColor`);
    assertModelColor(raw.shapeColor, `${where}.shapeColor`);
  });
  const layers = coerceLayers(rawLayers);
  if (layers.length !== rawLayers.length) {
    throw new Error("one or more layers could not be coerced");
  }
  if (!layers.some((l) => l.visible && l.type === "text")) {
    throw new Error("at least one visible text layer is required");
  }

  const fields = draftFullSchema(family);
  const mergedParams: StyleParams = {
    ...defaultParams(fields),
    ...coerceParams(fields, coercedBase, { partial: true }),
  };
  return { name: name.slice(0, 80), tags, defaultParams: mergedParams, layers };
}

function aiDraftPrompt(description: string, family: StyleFamily): string {
  const baseFields = draftBaseSchema(family)
    .map((f) => {
      const bits = [`"${f.key}" (${f.type}`];
      if (f.min !== undefined || f.max !== undefined) bits.push(`range ${f.min}–${f.max}`);
      if (f.options) bits.push(`one of: ${f.options.map((o) => o.value).join(", ")}`);
      bits.push(`default ${JSON.stringify(f.defaultValue)}`);
      return `- ${bits.join("; ")}) — ${f.label}`;
    })
    .join("\n");
  const fonts = listFonts()
    .map((f) => `${f.family} (weights: ${f.weights.join("/")}${f.italics.length ? `, italics: ${f.italics.join("/")}` : ""})`)
    .join("; ");
  const bindGuidance =
    family === "quote"
      ? 'Bind the main text layer to "quote" (it renders the quote text). Attribution/secondary layers can be unbound static text.'
      : 'Bind the main text layer to "lyrics" (it renders the song lyrics with karaoke/word/line modes). Secondary layers can be unbound static text.';

  return `Design a ${family === "quote" ? "quote card" : "lyric caption"} video text-overlay style matching this creative direction:
"${description}"

You are designing a LAYERED style: a stack of positioned layers on a transparent or solid canvas. Respond with a single raw JSON object (no markdown fences, no commentary) of this exact shape:
{
  "name": string,              // short style name, <= 60 chars
  "tags": string[],            // <= 6 lowercase discovery tags (e.g. "trend", "karaoke", "bold")
  "baseParams": { ... },       // canvas-wide params, ONLY the keys listed below
  "layers": [ ... ]            // 1–6 layers, bottom first
}

BASE PARAMS (use ONLY these keys):
${baseFields}

LAYER MODEL (each layer):
- id: string (any unique slug, e.g. "main", "accent-bar")
- type: "text" | "image" | "shape"
- name: short label
- visible: boolean
- xPercent, yPercent: 0–100 — the layer block's CENTER as a % of the canvas
- widthPercent: 2–100 — block width as a % of canvas width
- zIndex: integer (0 = bottom; array order is render order)
Text layers also have:
- bind: "lyrics" | "quote" | null (null = render the layer's own static "text")
- text: string (static content when unbound)
- fontFamily, fontWeight (100–900), fontSize (8–400), italic,
  textColor, highlightColor (karaoke/active-word color), textTransform
  ("none"|"uppercase"|"lowercase"), letterSpacing (-4–20), lineHeight (1–2.5),
  alignment ("left"|"center"|"right")
Shape layers also have: shapeColor, shapeOpacity (0–1), heightPercent (1–100), borderRadius (0–200)
Image layers also have: imageUrl (leave "" — admins upload later)
All layers: entryType ("fade"|"slide-up"|"pop"|"none"), entryDurationMs (0–2000), delayMs (0–10000)

Available fontFamily values: ${fonts}

Rules:
- ${bindGuidance}
- Colors are #RRGGBB hex; "transparent" is valid only for bgColor/text colors, not shapes.
- bgColor MUST be set explicitly in baseParams: "transparent" for an overlay style, or a solid hex.
- fontWeight must be one of the chosen family's available weights; respect all ranges and enums exactly.
- At least one visible text layer is required.`;
}

async function callGeminiForDraft(apiKey: string, prompt: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      systemInstruction:
        "You are a video caption style designer. You translate a short creative direction into a concrete JSON layer-stack design for a Remotion text-overlay template. You output ONLY valid JSON — no markdown, no commentary.",
    },
  });
  return (response.text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

/**
 * Admin "New template": Gemini designs a layered style from a creative
 * description → validated (strict; one retry with the error fed back) →
 * persisted as a StyleTemplate row (source "ai_draft", status "draft",
 * templateKey ai_<slug>). Drafts render through the layered-style comp, so
 * they compile by construction — no AI-written code is ever executed.
 */
export async function generateAiDraftTemplate(opts: {
  description: string;
  family: StyleFamily;
  createdBy?: string;
}) {
  const description = opts.description.trim();
  if (!description) throw new Error("Description is required");
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY environment variable is missing");

  const basePrompt = aiDraftPrompt(description, opts.family);
  let lastError = "";
  let draft: ReturnType<typeof validateAiDraftJson> | null = null;

  for (let attempt = 0; attempt < 2 && !draft; attempt++) {
    const prompt = lastError
      ? `${basePrompt}\n\nYour previous answer was rejected: ${lastError}\nReturn a corrected JSON object only.`
      : basePrompt;
    const text = await callGeminiForDraft(apiKey, prompt);
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      lastError = "response was not parseable JSON";
      continue;
    }
    try {
      draft = validateAiDraftJson(parsed, opts.family);
    } catch (err: any) {
      lastError = err?.message ?? "invalid draft";
    }
  }
  if (!draft) {
    throw new Error(`AI draft generation failed validation: ${lastError}`);
  }

  const key = await uniqueDraftKey(draft.name);
  const payload: DraftTemplatePayload = {
    fields: draftFullSchema(opts.family),
    layers: layersToJson(draft.layers),
    defaultParams: draft.defaultParams,
    family: opts.family,
    validation: null,
  };
  const row = await prisma.styleTemplate.create({
    data: {
      key,
      name: draft.name,
      engine: "remotion",
      paramSchema: JSON.stringify(payload),
      isBase: true, // gallery row (drafts shelf until published)
      source: "ai_draft",
      status: "draft",
      tags: draft.tags,
      createdBy: opts.createdBy,
    },
  });
  return decorateTemplateRow(row);
}

export async function listAiDrafts() {
  const rows = await prisma.styleTemplate.findMany({
    where: { source: "ai_draft", status: "draft" },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(decorateTemplateRow);
}

export async function updateDraftTemplate(
  id: string,
  data: {
    name?: string;
    tags?: string[];
    defaultParams?: StyleParams;
    layers?: unknown;
  },
) {
  const row = await prisma.styleTemplate.findUnique({ where: { id } });
  if (!row || row.source !== "ai_draft") throw new Error("Draft template not found");
  if (row.status !== "draft") throw new Error("Only draft templates can be edited this way");
  const payload = parseDraftTemplatePayload(row.paramSchema);
  if (!payload) throw new Error("Draft template payload is malformed");

  if (data.defaultParams !== undefined) {
    payload.defaultParams = coerceParams(payload.fields, data.defaultParams); // throws on unknown keys
  }
  if (data.layers !== undefined) {
    const layers = coerceLayers(data.layers);
    if (layers.length === 0) throw new Error("Layer stack cannot be empty");
    payload.layers = layers;
  }
  // Any edit invalidates the previous validation — re-validate before publish.
  payload.validation = null;

  const updated = await prisma.styleTemplate.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name.trim().slice(0, 80) } : {}),
      ...(data.tags !== undefined ? { tags: data.tags } : {}),
      paramSchema: JSON.stringify({ ...payload, layers: layersToJson(payload.layers) }),
    },
  });
  return decorateTemplateRow(updated);
}

const DRAFT_PREVIEW_SECONDS = 2;

/**
 * Renders a draft's gallery assets (still thumbnail + ~2s hover preview)
 * through the layered-style composition. Throws on failure; runs the alpha
 * assertion for transparent (overlay) styles.
 */
async function renderDraftAssets(
  templateKey: string,
  payload: DraftTemplatePayload,
): Promise<{ thumbnail: string; preview: string }> {
  return enqueueRender(async () => {
    const params = coerceParams(payload.fields, payload.defaultParams);
    const layers = payload.layers;
    const inputProps: StyleParams = {
      ...params,
      layers,
      lines: SAMPLE_LYRIC_LINES,
      quoteText: SAMPLE_QUOTE.quoteText,
      author: SAMPLE_QUOTE.author,
    };

    const bundleLocation = await getBundle();
    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: LAYERED_TEMPLATE_KEY,
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

    // Hover preview: ~2s webm (VP9; alpha pixel format for overlays).
    const frames = Math.min(
      composition.durationInFrames,
      Math.max(1, Math.round(DRAFT_PREVIEW_SECONDS * composition.fps)),
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

    return urls;
  });
}

/**
 * Draft gate: (a) schema — payload parses, params + layers coerce cleanly;
 * (b) transparency — bgColor is explicitly "transparent" or a solid hex;
 * (c) render — still + 2s webm succeed (alpha assertion when transparent).
 * Persists the verdict into the row's paramSchema payload; sets the
 * thumbnail on success. Publish requires a recent all-green validation.
 */
export async function validateDraftTemplate(id: string): Promise<{
  ok: boolean;
  checks: { schema: boolean; transparency: boolean; render: boolean };
  thumbnailUrl?: string;
  errors: string[];
}> {
  const row = await prisma.styleTemplate.findUnique({ where: { id } });
  if (!row || row.source !== "ai_draft") throw new Error("Draft template not found");

  const checks = { schema: false, transparency: false, render: false };
  const errors: string[] = [];
  const payload = parseDraftTemplatePayload(row.paramSchema);

  // (a) schema / compile-equivalent: params coerce against the field schema
  // and the layer stack coerces losslessly.
  if (!payload || payload.fields.length === 0) {
    errors.push("schema: paramSchema payload is missing or malformed");
  } else {
    try {
      coerceParams(payload.fields, payload.defaultParams);
      if (payload.layers.length === 0) throw new Error("layer stack is empty");
      checks.schema = true;
    } catch (err: any) {
      errors.push(`schema: ${err?.message ?? "coercion failed"}`);
    }
  }

  // (b) transparency invariant: bgColor must be EXPLICIT — "transparent" or
  // a solid hex; an implicit/missing background is rejected.
  if (payload) {
    const bg = payload.defaultParams?.bgColor;
    if (bg === "transparent" || (typeof bg === "string" && HEX_COLOR_RE.test(bg))) {
      checks.transparency = true;
    } else {
      errors.push(
        'transparency: defaultParams.bgColor must be explicitly "transparent" or a solid #RRGGBB value',
      );
    }
  }

  // (c) render: still + short webm through the real render path.
  let thumbnailUrl: string | undefined;
  if (checks.schema && checks.transparency && payload) {
    try {
      const assets = await renderDraftAssets(row.key, payload);
      thumbnailUrl = assets.thumbnail;
      checks.render = true;
    } catch (err: any) {
      errors.push(`render: ${err?.message ?? "render failed"}`);
    }
  }

  const ok = checks.schema && checks.transparency && checks.render;
  const validation: DraftValidation = {
    ...checks,
    validatedAt: ok ? new Date().toISOString() : null,
    errors,
  };
  if (payload) {
    await prisma.styleTemplate.update({
      where: { id },
      data: {
        paramSchema: JSON.stringify({ ...payload, layers: layersToJson(payload.layers), validation }),
        ...(thumbnailUrl ? { thumbnail: thumbnailUrl } : {}),
      },
    });
  }
  return { ok, checks, ...(thumbnailUrl ? { thumbnailUrl } : {}), errors };
}

/** Publish requires a fully-green validation from the last hour. */
const PUBLISH_VALIDATION_MAX_AGE_MS = 60 * 60 * 1000;

export async function publishDraftTemplate(id: string) {
  const row = await prisma.styleTemplate.findUnique({ where: { id } });
  if (!row || row.source !== "ai_draft") throw new Error("Draft template not found");
  if (row.status === "published") return decorateTemplateRow(row); // idempotent

  const payload = parseDraftTemplatePayload(row.paramSchema);
  const v = payload?.validation;
  const fresh =
    !!v?.validatedAt && Date.now() - new Date(v.validatedAt).getTime() <= PUBLISH_VALIDATION_MAX_AGE_MS;
  if (!v || !v.schema || !v.transparency || !v.render || !fresh) {
    throw new Error(
      "Draft must pass validation (schema, transparency, render) within the last hour before publishing",
    );
  }

  const updated = await prisma.styleTemplate.update({
    where: { id },
    data: { status: "published" },
  });
  return decorateTemplateRow(updated);
}

export async function deleteDraftTemplate(id: string) {
  const row = await prisma.styleTemplate.findUnique({ where: { id } });
  if (!row || row.source !== "ai_draft") throw new Error("Draft template not found");
  if (row.status !== "draft") {
    throw new Error("Only draft templates can be deleted (published templates are part of the library)");
  }
  await prisma.styleTemplate.delete({ where: { id } });
}
