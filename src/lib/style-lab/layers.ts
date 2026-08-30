/**
 * Style Lab layer model — client-safe (like schema.ts): imported by the
 * admin editor, the LayeredStyle Remotion composition, and the server
 * service. No Node / Prisma / React imports.
 *
 * A saved style can carry a stack of layers (SavedStyle.layers Json?):
 *   - text  — static text, quote-bound text, or lyric-bound (karaoke) text
 *   - image — an uploaded logo/image (public/uploads/style-lab/)
 *   - shape — a colored strip/block
 *
 * Legacy styles have layers = null: their flat params object IS the single
 * main text layer (legacyParamsToLayers synthesizes it on the fly).
 *
 * Transform model: xPercent / yPercent mark the layer block's CENTER as a
 * percentage of the canvas; widthPercent is the block width as a percentage
 * of canvas width. Height is automatic (text), aspect-driven (image) or
 * heightPercent (shape). Keeping everything in percent shares the drag
 * math between the preview and the renderer.
 */

import { DEFAULT_FONT_FAMILY } from "../fonts";
import {
  familyForTemplate,
  resolveCanvas,
  type StyleParams,
} from "./schema";

/** Remotion composition id that renders any layer stack. */
export const LAYERED_TEMPLATE_KEY = "layered-style";

export type LayerType = "text" | "image" | "shape";

/**
 * Content binding for text layers:
 *   "lyrics" — renders the item's lyric lines (karaoke/word/line modes)
 *   "quote"  — renders the quoteText prop
 *   null     — renders the layer's own static `text`
 */
export type LayerBind = "lyrics" | "quote" | null;

export interface StyleLayer {
  id: string;
  type: LayerType;
  name: string;
  visible: boolean;
  // transform (percent of canvas; x/y = block center)
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  /** Render order is the array order; zIndex mirrors the index (0 = bottom). */
  zIndex: number;
  // text layers
  bind?: LayerBind;
  text?: string;
  fontFamily?: string;
  fontWeight?: number;
  fontSize?: number;
  italic?: boolean;
  textColor?: string;
  highlightColor?: string;
  textTransform?: string;
  letterSpacing?: number;
  lineHeight?: number;
  alignment?: string;
  // text styling (v2 — all optional; absent = off, legacy stacks unchanged)
  outlineColor?: string;
  outlineWidth?: number;
  shadow?: boolean;
  shadowIntensity?: number;
  /** When set, text renders as a linear gradient from textColor → textGradientTo. */
  textGradientTo?: string;
  // image layers
  imageUrl?: string;
  // shape layers
  shapeColor?: string;
  shapeOpacity?: number;
  heightPercent?: number;
  borderRadius?: number;
  /** When set, the shape fills with a linear gradient shapeColor → shapeGradientTo. */
  shapeGradientTo?: string;
  shapeGradientDeg?: number;
  // shared entry animation
  entryType?: string;
  entryDurationMs?: number;
  delayMs?: number;
  /** Entry easing: "spring" | "ease-out" | "ease-in-out" | "linear". */
  easing?: string;
  // continuous post-entry loop (composed AFTER the entry transform)
  /** "none" | "pulse" (scale 1→1.04→1) | "float" (y ±6px). */
  loopType?: string;
  /** Loop period; clamped to ≥ 400ms. */
  loopDurationMs?: number;
}

/** Stable id of the synthesized legacy main layer (never persisted). */
export const LEGACY_MAIN_LAYER_ID = "main";

export function newLayerId(): string {
  const c = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `layer_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Coercion ────────────────────────────────────────────────────────────────

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const TEXT_TRANSFORMS = new Set(["none", "uppercase", "lowercase"]);
const ALIGNMENTS = new Set(["left", "center", "right"]);
const ENTRY_TYPES = new Set(["fade", "slide-up", "pop", "none"]);
const EASINGS = new Set(["spring", "ease-out", "ease-in-out", "linear"]);
const LOOP_TYPES = new Set(["none", "pulse", "float"]);

function num(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "string" ? parseFloat(value) : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function color(value: unknown, fallback: string): string {
  const s = String(value ?? "").trim();
  return s === "transparent" || HEX_COLOR_RE.test(s) ? s : fallback;
}

function enumOf(value: unknown, allowed: Set<string>, fallback: string): string {
  const s = String(value ?? "");
  return allowed.has(s) ? s : fallback;
}

/** Tolerant per-layer coercion; returns null for unusable entries. */
function coerceLayer(raw: any, index: number): StyleLayer | null {
  if (!raw || typeof raw !== "object") return null;
  const type: LayerType =
    raw.type === "image" || raw.type === "shape" ? raw.type : "text";
  const layer: StyleLayer = {
    id: str(raw.id, "") || newLayerId(),
    type,
    name: str(raw.name, type === "text" ? "Text" : type === "image" ? "Image" : "Shape").slice(0, 60),
    visible: raw.visible !== false,
    xPercent: num(raw.xPercent, 50, 0, 100),
    yPercent: num(raw.yPercent, 50, 0, 100),
    widthPercent: num(raw.widthPercent, 86, 2, 100),
    zIndex: Number.isFinite(Number(raw.zIndex)) ? Number(raw.zIndex) : index,
  };
  if (type === "text") {
    layer.bind = raw.bind === "lyrics" || raw.bind === "quote" ? raw.bind : null;
    layer.text = typeof raw.text === "string" ? raw.text : "";
    layer.fontFamily = str(raw.fontFamily, DEFAULT_FONT_FAMILY);
    layer.fontWeight = num(raw.fontWeight, 700, 100, 900);
    layer.fontSize = num(raw.fontSize, 44, 8, 400);
    layer.italic = raw.italic === true;
    layer.textColor = color(raw.textColor, "#FFFFFF");
    layer.highlightColor = color(raw.highlightColor, "#E11D48");
    layer.textTransform = enumOf(raw.textTransform, TEXT_TRANSFORMS, "none");
    layer.letterSpacing = num(raw.letterSpacing, 0, -4, 20);
    layer.lineHeight = num(raw.lineHeight, 1.25, 1, 2.5);
    layer.alignment = enumOf(raw.alignment, ALIGNMENTS, "center");
    // v2 fields are opt-in: only coerced when present so legacy stacks
    // coerce byte-identically (absent = off).
    if (raw.outlineColor !== undefined) layer.outlineColor = color(raw.outlineColor, "#000000");
    if (raw.outlineWidth !== undefined) layer.outlineWidth = num(raw.outlineWidth, 0, 0, 12);
    if (raw.shadow !== undefined) layer.shadow = raw.shadow === true;
    if (raw.shadowIntensity !== undefined) layer.shadowIntensity = num(raw.shadowIntensity, 0.4, 0, 1);
    if (raw.textGradientTo !== undefined) {
      const c = color(raw.textGradientTo, "");
      if (c) layer.textGradientTo = c;
    }
  } else if (type === "image") {
    layer.imageUrl = str(raw.imageUrl, "");
  } else {
    layer.shapeColor = color(raw.shapeColor, "#000000");
    layer.shapeOpacity = num(raw.shapeOpacity, 0.6, 0, 1);
    layer.heightPercent = num(raw.heightPercent, 12, 1, 100);
    layer.borderRadius = num(raw.borderRadius, 0, 0, 200);
    if (raw.shapeGradientTo !== undefined) {
      const c = color(raw.shapeGradientTo, "");
      if (c) layer.shapeGradientTo = c;
    }
    if (raw.shapeGradientDeg !== undefined) layer.shapeGradientDeg = num(raw.shapeGradientDeg, 180, 0, 360);
  }
  layer.entryType = enumOf(raw.entryType, ENTRY_TYPES, "fade");
  layer.entryDurationMs = num(raw.entryDurationMs, 300, 0, 2000);
  layer.delayMs = num(raw.delayMs, 0, 0, 10000);
  if (raw.easing !== undefined) layer.easing = enumOf(raw.easing, EASINGS, "ease-out");
  if (raw.loopType !== undefined) layer.loopType = enumOf(raw.loopType, LOOP_TYPES, "none");
  if (raw.loopDurationMs !== undefined) layer.loopDurationMs = num(raw.loopDurationMs, 2000, 400, 10000);
  return layer;
}

/**
 * Parses + validates a layers payload (array or JSON string). Never throws:
 * unusable entries are dropped. Output is sorted bottom→top with zIndex
 * re-normalized to the array index.
 */
export function coerceLayers(json: unknown): StyleLayer[] {
  let v: any = json;
  for (let i = 0; i < 2 && typeof v === "string"; i++) {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];
  return v
    .map((raw, i) => coerceLayer(raw, i))
    .filter((l): l is StyleLayer => l !== null)
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((l, i) => ({ ...l, zIndex: i }));
}

/** JSON-safe copy for Prisma Json columns / render input props. */
export function layersToJson(layers: StyleLayer[]): StyleLayer[] {
  return JSON.parse(JSON.stringify(layers));
}

// ─── Defaults ────────────────────────────────────────────────────────────────

export function defaultTextLayer(role: "main" | "attribution"): StyleLayer {
  const main = role === "main";
  return {
    id: newLayerId(),
    type: "text",
    name: main ? "Main text" : "Attribution",
    visible: true,
    xPercent: 50,
    yPercent: main ? 50 : 78,
    widthPercent: 86,
    zIndex: 0,
    bind: null,
    text: main ? "Your text here" : "— SleeckOS",
    fontFamily: DEFAULT_FONT_FAMILY,
    fontWeight: main ? 700 : 500,
    fontSize: main ? 44 : 24,
    italic: false,
    textColor: "#FFFFFF",
    highlightColor: "#E11D48",
    textTransform: "none",
    letterSpacing: 0,
    lineHeight: 1.25,
    alignment: "center",
    outlineColor: "#000000",
    outlineWidth: 0,
    shadow: false,
    shadowIntensity: 0.4,
    entryType: "fade",
    entryDurationMs: 300,
    delayMs: main ? 0 : 250,
    easing: "ease-out",
    loopType: "none",
    loopDurationMs: 2000,
  };
}

export function defaultImageLayer(): StyleLayer {
  return {
    id: newLayerId(),
    type: "image",
    name: "Image",
    visible: true,
    xPercent: 50,
    yPercent: 18,
    widthPercent: 22,
    zIndex: 0,
    imageUrl: "",
    entryType: "fade",
    entryDurationMs: 300,
    delayMs: 150,
    easing: "ease-out",
    loopType: "none",
    loopDurationMs: 2000,
  };
}

export function defaultShapeLayer(): StyleLayer {
  return {
    id: newLayerId(),
    type: "shape",
    name: "Shape strip",
    visible: true,
    xPercent: 50,
    yPercent: 50,
    widthPercent: 100,
    zIndex: 0,
    shapeColor: "#000000",
    shapeOpacity: 0.55,
    heightPercent: 18,
    borderRadius: 0,
    shapeGradientDeg: 180,
    entryType: "fade",
    entryDurationMs: 250,
    delayMs: 0,
    easing: "ease-out",
    loopType: "none",
    loopDurationMs: 2000,
  };
}

// ─── Legacy bridge ───────────────────────────────────────────────────────────

/**
 * Wraps a legacy flat-param style as a single main text layer. The layer's
 * typography + transform are copied from the flat params; its content stays
 * BOUND (lyrics for lyric templates, quote for quote templates) so the
 * layered composition keeps reading the item's content, exactly like the
 * base comps do. The synthesized layer id is the stable "main".
 */
export function legacyParamsToLayers(templateKey: string, params: StyleParams): StyleLayer[] {
  const family = familyForTemplate(templateKey) ?? "lyric";
  const canvas = resolveCanvas(params);
  const marginX = num(params?.marginX, family === "quote" ? 56 : 48, 0, canvas.width / 2);
  const maxWidth = num(params?.maxWidthPercent, 90, 10, 100);
  const innerWidthPercent = Math.max(10, 100 - (2 * marginX * 100) / canvas.width);

  return [
    {
      id: LEGACY_MAIN_LAYER_ID,
      type: "text",
      name: "Main text",
      visible: true,
      xPercent: 50,
      yPercent: num(params?.positionYPercent, 50, 0, 100),
      widthPercent: Math.round(innerWidthPercent * (maxWidth / 100)),
      zIndex: 0,
      bind: family === "quote" ? "quote" : "lyrics",
      text: "",
      fontFamily: str(params?.fontFamily, DEFAULT_FONT_FAMILY),
      fontWeight: num(params?.fontWeight, 700, 100, 900),
      fontSize: num(params?.fontSize, family === "quote" ? 48 : 44, 8, 400),
      italic: params?.italic === true,
      textColor: color(params?.textColor, "#FFFFFF"),
      highlightColor: color(params?.highlightColor, "#E11D48"),
      textTransform: enumOf(params?.textTransform, TEXT_TRANSFORMS, "none"),
      letterSpacing: num(params?.letterSpacing, 0, -4, 20),
      lineHeight: num(params?.lineHeight, 1.25, 1, 2.5),
      alignment: enumOf(params?.alignment, ALIGNMENTS, "center"),
      outlineColor: color(params?.outlineColor, "#000000"),
      outlineWidth: num(params?.outlineWidth, 0, 0, 12),
      shadow: params?.shadow === true,
      shadowIntensity: num(params?.shadowIntensity, 0.4, 0, 1),
      entryType: enumOf(params?.entryType, ENTRY_TYPES, "fade"),
      entryDurationMs: num(params?.entryDurationMs, 300, 0, 2000),
      delayMs: 0,
      easing: enumOf(params?.easing, EASINGS, "ease-out"),
    },
  ];
}

/**
 * The layer stack a render should use: the persisted/coerced stack when it
 * is non-empty, otherwise the synthesized legacy single-layer stack.
 */
export function layersForRender(
  templateKey: string,
  params: StyleParams,
  layers: unknown,
): StyleLayer[] {
  const coerced = coerceLayers(layers);
  if (coerced.length > 0) return coerced;
  return legacyParamsToLayers(templateKey, params);
}
