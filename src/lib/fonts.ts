/**
 * Self-hosted font manifest — single source of truth for bundled fonts.
 *
 * All files live under `public/fonts/<slug>/` as fully-static TTFs
 * (no variable axes — safe for FFmpeg drawtext, Pillow, and Remotion).
 * Sources: github.com/google/fonts (OFL). Rebuild with:
 *   ./venv/bin/python3 scripts/build_fonts.py
 *
 * This module is dependency-free on purpose: it is imported by Node
 * renderers (composer.ts), API routes, AND the Remotion browser bundle.
 */

export interface FontManifestEntry {
  /** Display family name, e.g. "IBM Plex Sans" — also the CSS font-family. */
  family: string;
  /** Directory name under public/fonts/. */
  slug: string;
  /** Upright weights present on disk. */
  weights: number[];
  /** Italic weights present on disk. */
  italics: number[];
  license: string;
  /**
   * Path (relative to `public/`, e.g. "fonts/inter/Inter-Bold.ttf") for the
   * nearest available weight — see nearestAvailableWeight.
   */
  fileFor: (weight: number, italic?: boolean) => string;
}

export const DEFAULT_FONT_FAMILY = "Inter";

const WEIGHT_NAMES: Record<number, string> = {
  100: "Thin",
  200: "ExtraLight",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "SemiBold",
  700: "Bold",
  800: "ExtraBold",
  900: "Black",
};

type FamilySpec = {
  family: string;
  slug: string;
  /** File-name prefix, e.g. "IBMPlexSans". */
  prefix: string;
  weights: number[];
  italics?: number[];
};

const FAMILIES: FamilySpec[] = [
  { family: "Inter", slug: "inter", prefix: "Inter", weights: [100, 200, 300, 400, 500, 600, 700, 800, 900] },
  { family: "IBM Plex Sans", slug: "ibmplexsans", prefix: "IBMPlexSans", weights: [400, 500, 600, 700] },
  { family: "Archivo", slug: "archivo", prefix: "Archivo", weights: [400, 600, 700, 800, 900] },
  { family: "Barlow", slug: "barlow", prefix: "Barlow", weights: [400, 600, 700, 800] },
  { family: "Barlow Condensed", slug: "barlowcondensed", prefix: "BarlowCondensed", weights: [500, 600, 700] },
  { family: "Oswald", slug: "oswald", prefix: "Oswald", weights: [400, 500, 600, 700] },
  { family: "Anton", slug: "anton", prefix: "Anton", weights: [400] },
  { family: "Public Sans", slug: "publicsans", prefix: "PublicSans", weights: [400, 600, 700, 800, 900], italics: [400, 700] },
  { family: "Libre Franklin", slug: "librefranklin", prefix: "LibreFranklin", weights: [400, 600, 700, 800, 900] },
  { family: "Source Sans 3", slug: "sourcesans3", prefix: "SourceSans3", weights: [400, 600, 700, 900] },
];

function fileName(prefix: string, weight: number, italic: boolean): string {
  if (italic) {
    return weight === 400
      ? `${prefix}-Italic.ttf`
      : `${prefix}-${WEIGHT_NAMES[weight]}Italic.ttf`;
  }
  return `${prefix}-${WEIGHT_NAMES[weight]}.ttf`;
}

/** Case/space/hyphen-insensitive family matching ("IBM Plex Sans" == "IBMPlexSans"). */
function normalizeFamily(family: string): string {
  return family.toLowerCase().replace(/[\s_-]+/g, "");
}

function findSpec(family: string): FamilySpec | undefined {
  const needle = normalizeFamily(family);
  return FAMILIES.find(
    (f) => normalizeFamily(f.family) === needle || normalizeFamily(f.prefix) === needle,
  );
}

function nearestIn(available: number[], target: number): number {
  let best = available[0];
  for (const w of available) {
    if (Math.abs(w - target) < Math.abs(best - target)) best = w;
  }
  return best;
}

export const FONT_MANIFEST: FontManifestEntry[] = FAMILIES.map((spec) => {
  const italics = spec.italics ?? [];
  return {
    family: spec.family,
    slug: spec.slug,
    weights: [...spec.weights],
    italics: [...italics],
    license: "OFL-1.1",
    fileFor: (weight: number, italic = false): string => {
      const pool = italic && italics.length > 0 ? italics : spec.weights;
      const resolved = nearestIn(pool, weight);
      const useItalic = italic && italics.length > 0;
      return `fonts/${spec.slug}/${fileName(spec.prefix, resolved, useItalic)}`;
    },
  };
});

export function listFonts(): FontManifestEntry[] {
  return FONT_MANIFEST;
}

/**
 * Nearest on-disk weight for a family. Falls back across the italic/upright
 * axis only when the requested style has no files at all.
 * Returns null for unknown families.
 */
export function nearestAvailableWeight(
  family: string,
  weight: number,
  italic = false,
): number | null {
  const spec = findSpec(family);
  if (!spec) return null;
  const italics = spec.italics ?? [];
  const pool = italic && italics.length > 0 ? italics : spec.weights;
  return nearestIn(pool, weight);
}

/**
 * Resolve a manifest font to a public/-relative file path
 * (e.g. "fonts/oswald/Oswald-SemiBold.ttf"), snapping to the nearest
 * available weight. Returns null when the family is not in the manifest.
 */
export function getFontFile(family: string, weight = 400, italic = false): string | null {
  const entry = FONT_MANIFEST.find(
    (f) => normalizeFamily(f.family) === normalizeFamily(family),
  );
  if (!entry) return null;
  return entry.fileFor(weight, italic);
}
