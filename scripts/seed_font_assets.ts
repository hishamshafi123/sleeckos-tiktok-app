/**
 * Seeds FontAsset rows from the self-hosted font manifest (src/lib/fonts.ts).
 * Idempotent — upserts by family.
 *
 * Run:  npx tsx scripts/seed_font_assets.ts
 *   (or, without tsx:  node_modules/.bin/esbuild scripts/seed_font_assets.ts \
 *        --bundle --platform=node --format=esm --packages=external \
 *        --outfile=scratch/seed_font_assets.mjs && node scratch/seed_font_assets.mjs)
 */
import prisma from "../src/lib/db";
import { FONT_MANIFEST, DEFAULT_FONT_FAMILY } from "../src/lib/fonts";

async function main() {
  console.log(`Seeding ${FONT_MANIFEST.length} FontAsset rows from FONT_MANIFEST...`);

  for (const entry of FONT_MANIFEST) {
    // files: { "400": "fonts/inter/Inter-Regular.ttf", "400i": "fonts/publicsans/PublicSans-Italic.ttf", ... }
    const files: Record<string, string> = {};
    for (const w of entry.weights) files[String(w)] = entry.fileFor(w);
    for (const w of entry.italics) files[`${w}i`] = entry.fileFor(w, true);

    const isDefault = entry.family === DEFAULT_FONT_FAMILY;

    await prisma.fontAsset.upsert({
      where: { family: entry.family },
      update: {
        weights: entry.weights,
        files,
        license: entry.license,
        isDefault,
      },
      create: {
        family: entry.family,
        weights: entry.weights,
        files,
        license: entry.license,
        isDefault,
      },
    });

    console.log(
      `  ✔ ${entry.family} — weights [${entry.weights.join(", ")}]` +
        (entry.italics.length ? ` italics [${entry.italics.join(", ")}]` : "") +
        (isDefault ? " (DEFAULT)" : ""),
    );
  }

  const count = await prisma.fontAsset.count();
  console.log(`Done. FontAsset rows in DB: ${count}`);
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
