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
import path from "path";
import fs from "fs";
import { listFonts } from "../fonts";
import {
  LYRIC_TEMPLATE_KEY,
  QUOTE_TEMPLATE_KEY,
  SAMPLE_LYRIC_LINES,
  SAMPLE_QUOTE,
  STYLE_LAB_TEMPLATES,
  coerceParams,
  defaultParams,
  familyForTemplate,
  schemaForTemplate,
  type StyleFamily,
  type StyleParams,
} from "../style-lab/schema";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "style-lab");

// ─── Templates ───────────────────────────────────────────────────────────────

/**
 * Idempotently registers the two Style Lab base templates as StyleTemplate
 * rows (engine "remotion", isBase). Called by the seed script and lazily by
 * GET /api/style-lab/templates so the page works before the seed runs.
 */
export async function seedStyleLabTemplates(createdBy?: string) {
  for (const tpl of STYLE_LAB_TEMPLATES) {
    await prisma.styleTemplate.upsert({
      where: { key: tpl.key },
      update: {
        name: tpl.name,
        engine: tpl.engine,
        paramSchema: JSON.stringify(tpl.schema),
        isBase: true,
      },
      create: {
        key: tpl.key,
        name: tpl.name,
        engine: tpl.engine,
        paramSchema: JSON.stringify(tpl.schema),
        isBase: true,
        createdBy,
      },
    });
  }
}

export async function getStyleLabTemplates() {
  await seedStyleLabTemplates();
  return prisma.styleTemplate.findMany({
    where: { isBase: true },
    orderBy: { createdAt: "asc" },
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

const LAB_TEMPLATE_KEYS = STYLE_LAB_TEMPLATES.map((t) => t.key);

/**
 * Styles managed by the Style Lab — i.e. presets of the two base templates.
 * Legacy style-studio presets keep living in the old studio until cleanup.
 */
export async function listSavedStyles(family?: StyleFamily) {
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

export async function renderTestSample(opts: {
  templateKey: string;
  params: StyleParams;
  format: TestRenderFormat;
}): Promise<{ url: string }> {
  return enqueueRender(async () => {
    const schema = assertLabTemplate(opts.templateKey);
    const family = familyForTemplate(opts.templateKey) ?? "lyric";
    const coerced = coerceParams(schema, opts.params);

    const inputProps: StyleParams =
      family === "quote"
        ? { ...coerced, quoteText: SAMPLE_QUOTE.quoteText, author: SAMPLE_QUOTE.author }
        : { ...coerced, lines: SAMPLE_LYRIC_LINES };

    const bundleLocation = await getBundle();
    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: opts.templateKey,
      inputProps,
    });

    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

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
      return { url: `/uploads/style-lab/${fileName}` };
    }

    // ~3s clip (or the full comp when shorter).
    const fileName = `test_${stamp}.mp4`;
    const outFile = path.join(UPLOAD_DIR, fileName);
    const frames = Math.min(composition.durationInFrames, 90);
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
