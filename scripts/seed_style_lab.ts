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

import { STYLE_LAB_PRESETS as PRESETS, type StyleLabPreset as PresetSpec } from "../src/lib/style-lab/presets";

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
