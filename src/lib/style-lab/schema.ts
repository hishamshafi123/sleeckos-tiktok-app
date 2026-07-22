/**
 * Style Lab param schemas — single source of truth for the two base
 * templates (lyric-caption, quote-card).
 *
 * Client-safe on purpose (like src/lib/fonts.ts): imported by the admin
 * control panel, the Remotion compositions, the server service, and the
 * seed script. No Node / Prisma / React imports.
 */

import { FONT_MANIFEST, DEFAULT_FONT_FAMILY } from "../fonts";

export type StyleFamily = "lyric" | "quote";

export const LYRIC_TEMPLATE_KEY = "lyric-caption";
export const QUOTE_TEMPLATE_KEY = "quote-card";

export type ParamFieldType =
  | "text"
  | "color"
  | "number"
  | "boolean"
  | "enum"
  | "font" // select of FONT_MANIFEST families
  | "weight"; // select filtered to the active fontFamily's available weights

export interface ParamFieldOption {
  value: string;
  label: string;
}

export interface ParamField {
  key: string;
  label: string;
  type: ParamFieldType;
  /** Panel section grouping, e.g. "Typography". */
  group: string;
  defaultValue: any;
  min?: number;
  max?: number;
  step?: number;
  options?: ParamFieldOption[];
}

export type StyleParams = Record<string, any>;

export interface LyricLine {
  text: string;
  startMs: number;
  endMs: number;
}

// ─── Shared fields (both families) ───────────────────────────────────────────

const TYPOGRAPHY_FIELDS: ParamField[] = [
  { key: "fontFamily", label: "Font Family", type: "font", group: "Typography", defaultValue: DEFAULT_FONT_FAMILY },
  { key: "fontWeight", label: "Font Weight", type: "weight", group: "Typography", defaultValue: 700, min: 100, max: 900, step: 100 },
  { key: "fontSize", label: "Font Size (px)", type: "number", group: "Typography", defaultValue: 44, min: 12, max: 160, step: 1 },
  { key: "letterSpacing", label: "Letter Spacing (px)", type: "number", group: "Typography", defaultValue: 0, min: -4, max: 20, step: 0.5 },
  { key: "lineHeight", label: "Line Height", type: "number", group: "Typography", defaultValue: 1.25, min: 1, max: 2.5, step: 0.05 },
  {
    key: "textTransform", label: "Text Case", type: "enum", group: "Typography", defaultValue: "none",
    options: [
      { value: "none", label: "None" },
      { value: "uppercase", label: "Uppercase" },
      { value: "lowercase", label: "Lowercase" },
    ],
  },
  { key: "italic", label: "Italic", type: "boolean", group: "Typography", defaultValue: false },
];

const COLOR_FIELDS: ParamField[] = [
  { key: "textColor", label: "Text Color", type: "color", group: "Colors", defaultValue: "#FFFFFF" },
  { key: "highlightColor", label: "Highlight Color", type: "color", group: "Colors", defaultValue: "#E11D48" },
  { key: "outlineColor", label: "Outline Color", type: "color", group: "Colors", defaultValue: "#000000" },
  { key: "outlineWidth", label: "Outline Width (px)", type: "number", group: "Colors", defaultValue: 0, min: 0, max: 12, step: 0.5 },
  { key: "shadow", label: "Text Shadow", type: "boolean", group: "Colors", defaultValue: true },
  { key: "shadowIntensity", label: "Shadow Intensity", type: "number", group: "Colors", defaultValue: 0.4, min: 0, max: 1, step: 0.05 },
];

const BACKGROUND_FIELDS: ParamField[] = [
  { key: "bgColor", label: "Background Color", type: "color", group: "Background", defaultValue: "#18181B" },
  { key: "stripColor", label: "Strip Color", type: "color", group: "Background", defaultValue: "#000000" },
  { key: "stripOpacity", label: "Strip Opacity", type: "number", group: "Background", defaultValue: 0, min: 0, max: 1, step: 0.05 },
];

const LAYOUT_FIELDS: ParamField[] = [
  { key: "positionYPercent", label: "Vertical Position (%)", type: "number", group: "Layout", defaultValue: 50, min: 0, max: 100, step: 1 },
  {
    key: "alignment", label: "Alignment", type: "enum", group: "Layout", defaultValue: "center",
    options: [
      { value: "left", label: "Left" },
      { value: "center", label: "Center" },
      { value: "right", label: "Right" },
    ],
  },
  { key: "marginX", label: "Horizontal Margin (px)", type: "number", group: "Layout", defaultValue: 48, min: 0, max: 240, step: 2 },
  { key: "maxWidthPercent", label: "Max Width (%)", type: "number", group: "Layout", defaultValue: 90, min: 20, max: 100, step: 1 },
  { key: "padding", label: "Strip Padding (px)", type: "number", group: "Layout", defaultValue: 16, min: 0, max: 80, step: 1 },
  {
    key: "aspectRatio", label: "Aspect Ratio", type: "enum", group: "Layout", defaultValue: "9:16",
    options: [
      { value: "9:16", label: "9:16 (Vertical)" },
      { value: "1:1", label: "1:1 (Square)" },
    ],
  },
];

const ANIMATION_FIELDS: ParamField[] = [
  {
    key: "entryType", label: "Entry Animation", type: "enum", group: "Animation", defaultValue: "fade",
    options: [
      { value: "fade", label: "Fade" },
      { value: "slide-up", label: "Slide Up" },
      { value: "pop", label: "Pop" },
      { value: "none", label: "None" },
    ],
  },
  { key: "entryDurationMs", label: "Entry Duration (ms)", type: "number", group: "Animation", defaultValue: 300, min: 0, max: 2000, step: 50 },
  {
    key: "easing", label: "Easing", type: "enum", group: "Animation", defaultValue: "ease-out",
    options: [
      { value: "spring", label: "Spring" },
      { value: "ease-out", label: "Ease Out" },
      { value: "ease-in-out", label: "Ease In / Out" },
      { value: "linear", label: "Linear" },
    ],
  },
  {
    key: "exitType", label: "Exit Animation", type: "enum", group: "Animation", defaultValue: "fade",
    options: [
      { value: "fade", label: "Fade" },
      { value: "none", label: "None" },
    ],
  },
];

const EFFECTS_FIELDS: ParamField[] = [
  { key: "pixelate", label: "Pixelate", type: "number", group: "Effects", defaultValue: 0, min: 0, max: 10, step: 1 },
  { key: "blur", label: "Blur (px)", type: "number", group: "Effects", defaultValue: 0, min: 0, max: 20, step: 0.5 },
  { key: "vignette", label: "Vignette", type: "number", group: "Effects", defaultValue: 0, min: 0, max: 1, step: 0.05 },
  { key: "grain", label: "Film Grain (animated)", type: "number", group: "Effects", defaultValue: 0, min: 0, max: 1, step: 0.05 },
  { key: "noise", label: "Noise (static)", type: "number", group: "Effects", defaultValue: 0, min: 0, max: 1, step: 0.05 },
];

// ─── Family schemas ──────────────────────────────────────────────────────────

export const LYRIC_ONLY_FIELDS: ParamField[] = [
  {
    key: "lineMode", label: "Line Mode", type: "enum", group: "Lyrics", defaultValue: "karaoke",
    options: [
      { value: "word-by-word", label: "Word by Word" },
      { value: "line-by-line", label: "Line by Line" },
      { value: "karaoke", label: "Karaoke" },
    ],
  },
  { key: "linesVisible", label: "Lines Visible", type: "number", group: "Lyrics", defaultValue: 2, min: 1, max: 3, step: 1 },
  { key: "timingOffsetMs", label: "Timing Offset (ms)", type: "number", group: "Lyrics", defaultValue: 0, min: -2000, max: 2000, step: 50 },
];

export const LYRIC_PARAM_SCHEMA: ParamField[] = [
  ...TYPOGRAPHY_FIELDS,
  ...COLOR_FIELDS,
  ...BACKGROUND_FIELDS,
  ...LAYOUT_FIELDS,
  ...LYRIC_ONLY_FIELDS,
  ...ANIMATION_FIELDS,
  ...EFFECTS_FIELDS,
];

export const QUOTE_PARAM_SCHEMA: ParamField[] = [
  ...TYPOGRAPHY_FIELDS.map((f) =>
    f.key === "fontSize" ? { ...f, defaultValue: 48 } : f,
  ),
  ...COLOR_FIELDS,
  ...BACKGROUND_FIELDS.map((f) =>
    f.key === "bgColor" ? { ...f, defaultValue: "#09090B" } : f,
  ),
  ...LAYOUT_FIELDS.map((f) =>
    f.key === "marginX" ? { ...f, defaultValue: 56 } : f,
  ),
  ...ANIMATION_FIELDS.map((f) => {
    if (f.key === "entryType") return { ...f, defaultValue: "slide-up" };
    if (f.key === "entryDurationMs") return { ...f, defaultValue: 500 };
    if (f.key === "easing") return { ...f, defaultValue: "spring" };
    if (f.key === "exitType") return { ...f, defaultValue: "none" };
    return f;
  }),
  ...EFFECTS_FIELDS,
];

export interface StyleLabTemplateMeta {
  key: string;
  name: string;
  family: StyleFamily;
  engine: "remotion";
  schema: ParamField[];
}

export const STYLE_LAB_TEMPLATES: StyleLabTemplateMeta[] = [
  {
    key: LYRIC_TEMPLATE_KEY,
    name: "Lyric Caption",
    family: "lyric",
    engine: "remotion",
    schema: LYRIC_PARAM_SCHEMA,
  },
  {
    key: QUOTE_TEMPLATE_KEY,
    name: "Quote Card",
    family: "quote",
    engine: "remotion",
    schema: QUOTE_PARAM_SCHEMA,
  },
];

export function schemaForTemplate(templateKey: string): ParamField[] | null {
  const tpl = STYLE_LAB_TEMPLATES.find((t) => t.key === templateKey);
  return tpl ? tpl.schema : null;
}

export function familyForTemplate(templateKey: string): StyleFamily | null {
  const tpl = STYLE_LAB_TEMPLATES.find((t) => t.key === templateKey);
  return tpl ? tpl.family : null;
}

// ─── Defaults / validation ───────────────────────────────────────────────────

export function defaultParams(schema: ParamField[]): StyleParams {
  const out: StyleParams = {};
  for (const f of schema) out[f.key] = f.defaultValue;
  return out;
}

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function coerceField(field: ParamField, value: any): any {
  switch (field.type) {
    case "number":
    case "weight": {
      const n = typeof value === "string" ? parseFloat(value) : Number(value);
      if (!Number.isFinite(n)) return field.defaultValue;
      let v = n;
      if (field.min !== undefined) v = Math.max(field.min, v);
      if (field.max !== undefined) v = Math.min(field.max, v);
      if (field.type === "weight") v = Math.round(v / 100) * 100 || 400;
      return v;
    }
    case "boolean":
      if (typeof value === "string") return value === "true" || value === "1";
      return Boolean(value);
    case "enum": {
      const s = String(value);
      const ok = (field.options ?? []).some((o) => o.value === s);
      return ok ? s : field.defaultValue;
    }
    case "font": {
      const s = String(value);
      const ok = FONT_MANIFEST.some(
        (f) => f.family.toLowerCase() === s.toLowerCase(),
      );
      if (!ok) return field.defaultValue;
      return FONT_MANIFEST.find((f) => f.family.toLowerCase() === s.toLowerCase())!.family;
    }
    case "color": {
      const s = String(value).trim();
      if (s === "transparent" || HEX_COLOR_RE.test(s)) return s;
      return field.defaultValue;
    }
    case "text":
    default:
      return String(value ?? "");
  }
}

/**
 * Validates + coerces a param object against a template schema.
 * - Unknown keys are REJECTED (throws).
 * - Known keys are coerced/clamped; missing keys fall back to defaults
 *   when `partial` is false, or left out when `partial` is true.
 */
export function coerceParams(
  schema: ParamField[],
  input: StyleParams,
  opts: { partial?: boolean } = {},
): StyleParams {
  const partial = opts.partial ?? false;
  const known = new Map(schema.map((f) => [f.key, f]));
  const out: StyleParams = partial ? {} : defaultParams(schema);

  for (const [key, value] of Object.entries(input ?? {})) {
    const field = known.get(key);
    if (!field) {
      throw new Error(`Unknown param "${key}" for this template`);
    }
    out[key] = coerceField(field, value);
  }
  return out;
}

// ─── Canvas / duration resolution (shared by Player, calculateMetadata, render) ─

export function resolveCanvas(params: StyleParams): { width: number; height: number } {
  return params?.aspectRatio === "1:1"
    ? { width: 1080, height: 1080 }
    : { width: 720, height: 1280 };
}

export const STYLE_LAB_FPS = 30;

export function resolveDurationMs(family: StyleFamily, content: { lines?: LyricLine[] }): number {
  if (family === "quote") return 6000;
  const lines = content.lines ?? [];
  const lastEnd = lines.reduce((m, l) => Math.max(m, l.endMs), 0);
  return Math.min(Math.max(lastEnd + 600, 2000), 30000);
}

// ─── Sample content (editor preview + test renders) ──────────────────────────

export const SAMPLE_LYRIC_LINES: LyricLine[] = [
  { text: "We were never meant to fade away", startMs: 0, endMs: 2400 },
  { text: "Every skyline knows your name", startMs: 2600, endMs: 5000 },
  { text: "So hold the light and let it stay", startMs: 5200, endMs: 7600 },
  { text: "We burn brighter than the flame", startMs: 7800, endMs: 10200 },
  { text: "Tonight, tonight", startMs: 10400, endMs: 12400 },
];

export const SAMPLE_QUOTE = {
  quoteText: "Discipline is choosing what you want most over what you want now.",
  author: "SleeckOS",
};
