/**
 * Seeds the Style Lab base templates (lyric-caption, quote-card) as
 * StyleTemplate rows (engine "remotion", isBase) plus the starter
 * saved-style presets for both families.
 *
 * Idempotent — templates upsert by key; presets migrate by name (so a preset
 * that moves templates, e.g. Brat → brat-lyrics, updates instead of
 * duplicating); default saved styles are ensured per published template.
 *
 * Run (tsx is NOT installed — use the repo esbuild+node pattern):
 *   node_modules/.bin/esbuild scripts/seed_style_lab.ts \
 *     --bundle --platform=node --format=esm --packages=external \
 *     --tsconfig=tsconfig.json \
 *     --outfile=scratch/seed_style_lab.mjs && node scratch/seed_style_lab.mjs
 */
import prisma from "../src/lib/db";
import { ALL_STYLE_LAB_TEMPLATES } from "../src/lib/style-lab/schema";
import { seedDefaultSavedStyles, seedStyleLabPresets } from "../src/lib/services/style-lab";

import { STYLE_LAB_PRESETS as PRESETS } from "../src/lib/style-lab/presets";

async function main() {
  // 1. Templates (base + brat + imported collection)
  for (const tpl of ALL_STYLE_LAB_TEMPLATES) {
    const source = tpl.source ?? "builtin";
    const tags = tpl.tags ?? ["style-lab", "base", tpl.family];
    const row = await prisma.styleTemplate.upsert({
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
      },
    });
    console.log(`Template upserted: ${row.key} (${row.name}, source=${row.source})`);
  }

  // 2. Saved-style presets (validated/coerced by the service; migrates by
  //    name when a preset moves templates, e.g. Brat → brat-lyrics)
  await seedStyleLabPresets();
  console.log(`Presets seeded: ${PRESETS.length}`);

  // 3. Default saved styles for every published template (factory visibility)
  await seedDefaultSavedStyles();
  console.log("Default saved styles ensured for all published templates.");

  console.log("Style Lab seed complete.");
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
