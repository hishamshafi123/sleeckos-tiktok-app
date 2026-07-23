/**
 * Imported template collection — metadata + lean param schemas for the
 * components ported from reactvideoeditor/remotion-templates (MIT) into
 * src/remotion/compositions/style-lab/imported/.
 *
 * Client-safe (data only, like schema.ts): consumed by the admin gallery,
 * the Remotion registration (durations), the server service (seeding,
 * coercion) and the seed script.
 *
 * Schemas use only the control panel's existing field types
 * (text / color / number / boolean / enum / font / weight) so the
 * auto-generated editor works unchanged. Per-template defaults are baked
 * into each field's defaultValue — one schema row = one template's
 * defaultParams.
 */

import type { ParamField, StyleFamily, StyleLabTemplateMeta } from "./schema";

export interface ImportedTemplateMeta extends StyleLabTemplateMeta {
  /** Fixed clip length (imported comps are not line-timing driven). */
  durationMs: number;
}

// ─── Lean field builders (defaults set per template) ─────────────────────────

const textField = (defaultValue: string, label = "Text"): ParamField => ({
  key: "text", label, type: "text", group: "Content", defaultValue,
});
const subtitleField = (defaultValue: string): ParamField => ({
  key: "subtitle", label: "Subtitle", type: "text", group: "Content", defaultValue,
});
const labelField = (defaultValue: string): ParamField => ({
  key: "label", label: "Label", type: "text", group: "Content", defaultValue,
});
const fontFamilyField = (defaultValue = "Inter"): ParamField => ({
  key: "fontFamily", label: "Font Family", type: "font", group: "Typography", defaultValue,
});
const fontWeightField = (defaultValue = 700): ParamField => ({
  key: "fontWeight", label: "Font Weight", type: "weight", group: "Typography",
  defaultValue, min: 100, max: 900, step: 100,
});
const fontSizeField = (defaultValue = 56): ParamField => ({
  key: "fontSize", label: "Font Size (px)", type: "number", group: "Typography",
  defaultValue, min: 16, max: 220, step: 1,
});
const textColorField = (defaultValue = "#FAFAFA"): ParamField => ({
  key: "textColor", label: "Text Color", type: "color", group: "Colors", defaultValue,
});
const accentColorField = (defaultValue = "#E11D48"): ParamField => ({
  key: "accentColor", label: "Accent Color", type: "color", group: "Colors", defaultValue,
});
const bgColorField = (defaultValue = "transparent"): ParamField => ({
  key: "bgColor", label: "Background Color", type: "color", group: "Background", defaultValue,
});
const positionYField = (defaultValue = 50): ParamField => ({
  key: "positionYPercent", label: "Vertical Position (%)", type: "number", group: "Layout",
  defaultValue, min: 0, max: 100, step: 1,
});
const speedField = (): ParamField => ({
  key: "animationSpeed", label: "Animation Speed", type: "number", group: "Animation",
  defaultValue: 1, min: 0.25, max: 3, step: 0.05,
});

// ─── The collection ──────────────────────────────────────────────────────────

function meta(m: {
  key: string;
  name: string;
  family: StyleFamily;
  tags: string[];
  durationMs: number;
  schema: ParamField[];
}): ImportedTemplateMeta {
  return { ...m, engine: "remotion", source: "imported" };
}

export const IMPORTED_STYLE_TEMPLATES: ImportedTemplateMeta[] = [
  meta({
    key: "imp-kinetic-chars",
    name: "Kinetic Characters",
    family: "lyric",
    tags: ["trend", "kinetic"],
    durationMs: 4000,
    schema: [
      textField("midnight in the city"),
      fontFamilyField("Archivo"), fontWeightField(800), fontSizeField(64),
      textColorField(), bgColorField(), positionYField(), speedField(),
    ],
  }),
  meta({
    key: "imp-bounce-title",
    name: "Bounce Title Card",
    family: "quote",
    tags: ["bold"],
    durationMs: 4500,
    schema: [
      textField("Start Building", "Title"),
      subtitleField("There's never been a better time"),
      fontFamilyField("Archivo"), fontWeightField(900), fontSizeField(56),
      textColorField(), accentColorField(), bgColorField(), positionYField(), speedField(),
    ],
  }),
  meta({
    key: "imp-bubble-pop",
    name: "Bubble Pop Letters",
    family: "lyric",
    tags: ["trend"],
    durationMs: 3500,
    schema: [
      textField("HELLO"),
      fontFamilyField("Anton"), fontWeightField(400), fontSizeField(52),
      textColorField(), accentColorField(), bgColorField(), positionYField(), speedField(),
    ],
  }),
  meta({
    key: "imp-chapter-title",
    name: "Chapter Title",
    family: "quote",
    tags: ["minimal", "cinematic"],
    durationMs: 5000,
    schema: [
      labelField("CHAPTER"),
      textField("01", "Number"),
      subtitleField("The Beginning"),
      fontFamilyField("Inter"), fontWeightField(800), fontSizeField(120),
      textColorField(), accentColorField(), bgColorField("#09090B"), positionYField(), speedField(),
    ],
  }),
  meta({
    key: "imp-cinematic-title",
    name: "Cinematic Title",
    family: "quote",
    tags: ["bold", "cinematic"],
    durationMs: 5000,
    schema: [
      textField("Your Story Begins", "Title"),
      subtitleField("A cinematic experience"),
      fontFamilyField("Libre Franklin"), fontWeightField(700), fontSizeField(52),
      textColorField(), accentColorField(), bgColorField("#09090B"), positionYField(), speedField(),
    ],
  }),
  meta({
    key: "imp-credits-roll",
    name: "Credits Roll",
    family: "quote",
    tags: ["minimal", "cinematic"],
    durationMs: 9000,
    schema: [
      textField("Director: Jane Smith\nProducer: John Doe\nMusic: David Kim\nEditor: Michael Park", "Credits (Role: Name per line)"),
      fontFamilyField("Inter"), fontWeightField(600), fontSizeField(30),
      textColorField(), accentColorField(), bgColorField("#09090B"), speedField(),
    ],
  }),
  meta({
    key: "imp-floating-bubble",
    name: "Floating Bubble",
    family: "lyric",
    tags: ["trend"],
    durationMs: 4000,
    schema: [
      textField("floating"),
      fontFamilyField("Inter"), fontWeightField(700), fontSizeField(56),
      textColorField(), accentColorField("#18181B"), bgColorField(), positionYField(), speedField(),
    ],
  }),
  meta({
    key: "imp-glitch-text",
    name: "Glitch Text",
    family: "lyric",
    tags: ["trend"],
    durationMs: 3000,
    schema: [
      textField("GLITCH"),
      fontFamilyField("Archivo"), fontWeightField(900), fontSizeField(84),
      textColorField(), accentColorField(), bgColorField("#09090B"), positionYField(), speedField(),
    ],
  }),
  meta({
    key: "imp-lower-third",
    name: "News Lower Third",
    family: "quote",
    tags: ["news"],
    durationMs: 5000,
    schema: [
      textField("Jane Cooper", "Name"),
      subtitleField("Senior Producer"),
      fontFamilyField("Oswald"), fontWeightField(600), fontSizeField(34),
      textColorField(), accentColorField(), bgColorField(), positionYField(78), speedField(),
    ],
  }),
  meta({
    key: "imp-popping-text",
    name: "Popping Text",
    family: "lyric",
    tags: ["bold", "trend"],
    durationMs: 3500,
    schema: [
      textField("BINGO!"),
      fontFamilyField("Anton"), fontWeightField(400), fontSizeField(110),
      textColorField(), accentColorField(), bgColorField("#09090B"), positionYField(), speedField(),
    ],
  }),
  meta({
    key: "imp-pulsing-text",
    name: "Pulsing Text",
    family: "lyric",
    tags: ["trend"],
    durationMs: 3000,
    schema: [
      textField("PULSE"),
      fontFamilyField("Archivo"), fontWeightField(800), fontSizeField(84),
      textColorField(), bgColorField("#09090B"), positionYField(), speedField(),
    ],
  }),
  meta({
    key: "imp-quote-fade",
    name: "Classic Quote Fade",
    family: "quote",
    tags: ["minimal"],
    durationMs: 5000,
    schema: [
      textField("Design is not just what it looks like. Design is how it works.", "Quote"),
      subtitleField("Steve Jobs"),
      fontFamilyField("Libre Franklin"), fontWeightField(400), fontSizeField(34),
      textColorField("#E4E4E7"), accentColorField(), bgColorField("#09090B"), positionYField(), speedField(),
    ],
  }),
  meta({
    key: "imp-slide-text",
    name: "Slide-In Text",
    family: "lyric",
    tags: ["minimal"],
    durationMs: 3500,
    schema: [
      textField("Slide right in", "Title"),
      subtitleField("clean and simple"),
      fontFamilyField("Public Sans"), fontWeightField(800), fontSizeField(60),
      textColorField(), accentColorField(), bgColorField(), positionYField(), speedField(),
    ],
  }),
  meta({
    key: "imp-text-highlight",
    name: "Word Highlight Sweep",
    family: "lyric",
    tags: ["karaoke", "trend"],
    durationMs: 5000,
    schema: [
      textField("Build amazing videos with code"),
      fontFamilyField("Inter"), fontWeightField(800), fontSizeField(56),
      textColorField(), accentColorField(), bgColorField(), positionYField(), speedField(),
    ],
  }),
  meta({
    key: "imp-title-split",
    name: "Split Title",
    family: "quote",
    tags: ["bold"],
    durationMs: 4000,
    schema: [
      textField("CREATIVE", "Top Line"),
      subtitleField("STUDIO"),
      fontFamilyField("Archivo"), fontWeightField(800), fontSizeField(84),
      textColorField(), accentColorField(), bgColorField("#09090B"), positionYField(), speedField(),
    ],
  }),
  meta({
    key: "imp-typewriter",
    name: "Typewriter",
    family: "lyric",
    tags: ["minimal"],
    durationMs: 4000,
    schema: [
      textField("i like typing…"),
      fontFamilyField("IBM Plex Sans"), fontWeightField(600), fontSizeField(44),
      textColorField(), accentColorField(), bgColorField(), positionYField(), speedField(),
    ],
  }),
  meta({
    key: "imp-spotlight-reveal",
    name: "Spotlight Reveal",
    family: "quote",
    tags: ["cinematic", "trend"],
    durationMs: 4000,
    schema: [
      textField("REVEALED", "Title"),
      subtitleField("spotlight reveal"),
      fontFamilyField("Archivo"), fontWeightField(800), fontSizeField(56),
      textColorField(), accentColorField(), bgColorField("#09090B"), positionYField(), speedField(),
    ],
  }),
  meta({
    key: "imp-animated-list",
    name: "Staggered List",
    family: "quote",
    tags: ["minimal"],
    durationMs: 4500,
    schema: [
      textField("First idea\nSecond idea\nThird idea", "Items (one per line)"),
      fontFamilyField("Inter"), fontWeightField(600), fontSizeField(34),
      textColorField(), accentColorField(), bgColorField(), positionYField(), speedField(),
    ],
  }),
];

export function importedTemplateMeta(key: string): ImportedTemplateMeta | null {
  return IMPORTED_STYLE_TEMPLATES.find((t) => t.key === key) ?? null;
}
