/**
 * Seeds every Style Lab template (base + brat + the imported collection)
 * and renders each template's gallery assets with its schema defaults:
 *
 *   public/uploads/style-lab/tpl_<key>.png           (gallery thumbnail)
 *   public/uploads/style-lab/tpl_<key>_preview.webm  (~2.5s hover preview)
 *
 * Idempotent — rows upsert by key, renders overwrite the same filenames.
 * Pass a template key as argv[2] to render just one template.
 *
 * Run (tsx is NOT installed — use the repo esbuild+node pattern):
 *   node_modules/.bin/esbuild scripts/seed_imported_templates.ts \
 *     --bundle --platform=node --format=esm --packages=external \
 *     --tsconfig=tsconfig.json \
 *     --outfile=scratch/seed_imported_templates.mjs && \
 *   node scratch/seed_imported_templates.mjs
 */
import prisma from "../src/lib/db";
import { ALL_STYLE_LAB_TEMPLATES } from "../src/lib/style-lab/schema";
import { renderTemplateAssets, seedDefaultSavedStyles, seedStyleLabTemplates } from "../src/lib/services/style-lab";

async function main() {
  await seedStyleLabTemplates();
  console.log(`Templates upserted: ${ALL_STYLE_LAB_TEMPLATES.length}`);

  // Default saved styles for every published template (factory visibility).
  await seedDefaultSavedStyles();
  console.log("Default saved styles ensured for all published templates.");

  const only = process.argv[2];
  let failures = 0;
  for (const tpl of ALL_STYLE_LAB_TEMPLATES) {
    if (only && tpl.key !== only) continue;
    const t0 = Date.now();
    try {
      const { thumbnail, preview } = await renderTemplateAssets(tpl.key);
      console.log(`[ok]   ${tpl.key}  ${thumbnail} + ${preview}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (err) {
      failures++;
      console.error(`[fail] ${tpl.key}:`, err);
    }
  }

  console.log(failures === 0 ? "Template asset seed complete." : `Done with ${failures} failure(s).`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
