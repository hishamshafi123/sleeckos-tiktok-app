/**
 * Seeds the Style Lab base templates (lyric-caption, quote-card) as
 * StyleTemplate rows (engine "remotion", isBase) plus the starter
 * saved-style presets for both families.
 *
 * Idempotent — templates upsert by key, presets upsert by (templateKey, name).
 *
 * Run (tsx is NOT installed — use the repo esbuild+node pattern):
 *   node_modules/.bin/esbuild scripts/seed_style_lab.ts \
 *     --bundle --platform=node --format=esm --packages=external \
 *     --outfile=scratch/seed_style_lab.mjs && node scratch/seed_style_lab.mjs
 */
import prisma from "../src/lib/db";
import {
  LYRIC_PARAM_SCHEMA,
  LYRIC_TEMPLATE_KEY,
  QUOTE_PARAM_SCHEMA,
  QUOTE_TEMPLATE_KEY,
  STYLE_LAB_TEMPLATES,
  coerceParams,
  type StyleParams,
} from "../src/lib/style-lab/schema";

interface PresetSpec {
  templateKey: string;
  family: "lyric" | "quote";
  name: string;
  tags: string[];
  params: StyleParams; // partial — gaps filled from schema defaults
}

const PRESETS: PresetSpec[] = [
  // ── Lyric family ──────────────────────────────────────────────────────────
  {
    templateKey: LYRIC_TEMPLATE_KEY,
    family: "lyric",
    name: "Brat",
    tags: ["preset", "brat"],
    params: {
      fontFamily: "Inter",
      fontWeight: 500,
      fontSize: 52,
      textTransform: "lowercase",
      textColor: "#000000",
      highlightColor: "#000000",
      bgColor: "#8ACE00",
      blur: 1.5,
      shadow: false,
      lineMode: "line-by-line",
      linesVisible: 1,
      entryType: "none",
      exitType: "none",
    },
  },
  {
    templateKey: LYRIC_TEMPLATE_KEY,
    family: "lyric",
    name: "Spotify Card",
    tags: ["preset", "karaoke"],
    params: {
      fontFamily: "Inter",
      fontWeight: 700,
      fontSize: 40,
      textColor: "#FFFFFF",
      highlightColor: "#1DB954",
      bgColor: "#121212",
      shadow: true,
      shadowIntensity: 0.35,
      lineMode: "karaoke",
      linesVisible: 2,
      positionYPercent: 62,
      entryType: "fade",
      entryDurationMs: 250,
    },
  },
  {
    templateKey: LYRIC_TEMPLATE_KEY,
    family: "lyric",
    name: "Minimal Lyric",
    tags: ["preset", "minimal"],
    params: {
      fontFamily: "Public Sans",
      fontWeight: 400,
      fontSize: 30,
      letterSpacing: 2,
      textTransform: "lowercase",
      textColor: "#F4F4F5",
      highlightColor: "#F4F4F5",
      bgColor: "#09090B",
      shadow: false,
      lineMode: "line-by-line",
      linesVisible: 1,
      positionYPercent: 78,
      entryType: "fade",
      entryDurationMs: 600,
      easing: "ease-in-out",
    },
  },
  {
    templateKey: LYRIC_TEMPLATE_KEY,
    family: "lyric",
    name: "News Lower-Third",
    tags: ["preset", "news"],
    params: {
      fontFamily: "Oswald",
      fontWeight: 600,
      fontSize: 34,
      letterSpacing: 1,
      textTransform: "uppercase",
      textColor: "#FFFFFF",
      highlightColor: "#E11D48",
      bgColor: "#18181B",
      stripColor: "#000000",
      stripOpacity: 0.85,
      padding: 22,
      alignment: "left",
      marginX: 40,
      maxWidthPercent: 92,
      positionYPercent: 78,
      lineMode: "line-by-line",
      linesVisible: 1,
      entryType: "slide-up",
      entryDurationMs: 350,
    },
  },
  {
    templateKey: LYRIC_TEMPLATE_KEY,
    family: "lyric",
    name: "Subtitle Box",
    tags: ["preset", "subtitle"],
    params: {
      fontFamily: "Source Sans 3",
      fontWeight: 600,
      fontSize: 30,
      textColor: "#FFFFFF",
      highlightColor: "#FFE951",
      bgColor: "#18181B",
      stripColor: "#000000",
      stripOpacity: 0.65,
      padding: 14,
      positionYPercent: 85,
      lineMode: "line-by-line",
      linesVisible: 1,
      entryType: "none",
      exitType: "none",
    },
  },
  // ── Quote family ──────────────────────────────────────────────────────────
  {
    templateKey: QUOTE_TEMPLATE_KEY,
    family: "quote",
    name: "Statement Card",
    tags: ["preset", "statement"],
    params: {
      fontFamily: "Archivo",
      fontWeight: 800,
      fontSize: 54,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      textColor: "#FAFAFA",
      highlightColor: "#E11D48",
      bgColor: "#09090B",
      shadow: true,
      shadowIntensity: 0.5,
      entryType: "slide-up",
      entryDurationMs: 500,
      easing: "spring",
    },
  },
  {
    templateKey: QUOTE_TEMPLATE_KEY,
    family: "quote",
    name: "Minimal Quote",
    tags: ["preset", "minimal"],
    params: {
      fontFamily: "Libre Franklin",
      fontWeight: 400,
      fontSize: 36,
      lineHeight: 1.5,
      textColor: "#E4E4E7",
      highlightColor: "#A1A1AA",
      bgColor: "#09090B",
      shadow: false,
      maxWidthPercent: 76,
      entryType: "fade",
      entryDurationMs: 800,
      easing: "ease-in-out",
    },
  },
];

async function main() {
  // 1. Base templates
  for (const tpl of STYLE_LAB_TEMPLATES) {
    const row = await prisma.styleTemplate.upsert({
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
      },
    });
    console.log(`Template upserted: ${row.key} (${row.name}, isBase=${row.isBase})`);
  }

  // 2. Saved-style presets (validated/coerced against the schema)
  const schemas = {
    [LYRIC_TEMPLATE_KEY]: LYRIC_PARAM_SCHEMA,
    [QUOTE_TEMPLATE_KEY]: QUOTE_PARAM_SCHEMA,
  } as const;

  for (const preset of PRESETS) {
    const schema = schemas[preset.templateKey as keyof typeof schemas];
    const full = coerceParams(schema, preset.params, { partial: true });
    const defaults = coerceParams(schema, {});
    const params = { ...defaults, ...full };

    const existing = await prisma.savedStyle.findFirst({
      where: { templateKey: preset.templateKey, name: preset.name },
    });
    if (existing) {
      await prisma.savedStyle.update({
        where: { id: existing.id },
        data: {
          params: JSON.stringify(params),
          family: preset.family,
          tags: preset.tags,
        },
      });
      console.log(`Preset updated:  ${preset.name} (${preset.family})`);
    } else {
      await prisma.savedStyle.create({
        data: {
          templateKey: preset.templateKey,
          name: preset.name,
          params: JSON.stringify(params),
          family: preset.family,
          tags: preset.tags,
        },
      });
      console.log(`Preset created:  ${preset.name} (${preset.family})`);
    }
  }

  console.log("Style Lab seed complete.");
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
