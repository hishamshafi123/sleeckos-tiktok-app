/**
 * Custom font infrastructure — runtime-installed fonts (no redeploy).
 *
 * Fonts come from two places:
 *   1. Google Fonts auto-fetch (installGoogleFont) — used by Style Match when
 *      Gemini identifies a family name from a reference video.
 *   2. Manual TTF upload (registerUploadedFont) — POST /api/style-lab/fonts/upload.
 *
 * Files live in `public/fonts/custom/<slug>/` as single-weight static TTFs,
 * are mirrored to R2 (so they survive container rebuilds), and are indexed in
 * two places kept in sync on every install:
 *   - FontAsset DB rows (source = "custom") — durable record, used to
 *     rehydrate missing local files from R2.
 *   - public/fonts/custom/manifest.json — dependency-free index read by the
 *     Remotion render path (src/remotion/fonts.ts, which must not bundle
 *     Prisma) and by getMergedFontManifest().
 */

import fs from "fs";
import path from "path";
import prisma from "../db";
import { FONT_MANIFEST, WEIGHT_NAMES, normalizeFamily } from "../fonts";
import { downloadFromR2, uploadToR2 } from "./storage";

export class FontInstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FontInstallError";
  }
}

/** One entry of public/fonts/custom/manifest.json. */
export interface CustomFontFileEntry {
  family: string;
  slug: string;
  weights: number[];
  italics: number[];
  /** { "400": "fonts/custom/<slug>/<File>-Regular.ttf", "400i": ... } */
  files: Record<string, string>;
  license: string;
  source: "custom";
}

/** Shape returned to callers and served by GET /api/style-lab/fonts/custom. */
export interface MergedFontManifestEntry {
  family: string;
  slug: string;
  weights: number[];
  italics: number[];
  license: string;
  source: "bundled" | "custom";
}

const CUSTOM_DIR = path.join(process.cwd(), "public", "fonts", "custom");
const CUSTOM_MANIFEST_PATH = path.join(CUSTOM_DIR, "manifest.json");
const MAX_FONT_BYTES = 5 * 1024 * 1024;
const DEFAULT_WEIGHT = 400;

/**
 * Shorthand → canonical Google Fonts family. Exact normalized matches always
 * win; aliases exist only for names Gemini/users commonly shorten. NEVER add
 * a "close enough" mapping — a wrong font is worse than a miss.
 */
const FAMILY_ALIASES: Record<string, string> = {
  bebas: "Bebas Neue",
};

// ─── Pure helpers (unit-tested by scratch/verify_custom_fonts.ts) ────────────

/** "Bebas Neue" → "bebasneue" (case/space/hyphen-insensitive). */
export function normalizeFontName(family: string): string {
  return normalizeFamily(family);
}

/** Directory slug for a custom family: lowercase alphanumerics only. */
export function slugifyFontFamily(family: string): string {
  return family.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** TTF/OTF magic: 00 01 00 00 (TrueType), 'true', 'OTTO' (CFF OpenType). */
export function isTtfBuffer(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  const magic = buf.subarray(0, 4).toString("latin1");
  return (
    (buf[0] === 0x00 && buf[1] === 0x01 && buf[2] === 0x00 && buf[3] === 0x00) ||
    magic === "true" ||
    magic === "OTTO"
  );
}

export interface GoogleFontFace {
  family: string;
  weight: number;
  italic: boolean;
  url: string;
}

/**
 * Parses a Google Fonts css2 response into { family, weight, italic, url }
 * faces. Pure — the css text is fetched by the caller so tests never touch
 * the network.
 */
export function parseGoogleFontsCss(css: string): GoogleFontFace[] {
  const faces: GoogleFontFace[] = [];
  const blockRe = /@font-face\s*\{([^}]*)\}/g;
  let block: RegExpExecArray | null;
  while ((block = blockRe.exec(css)) !== null) {
    const body = block[1];
    const family = /font-family:\s*'([^']+)'/.exec(body)?.[1];
    const weight = Number(/font-weight:\s*(\d+)/.exec(body)?.[1]);
    const style = /font-style:\s*(\w+)/.exec(body)?.[1] ?? "normal";
    const url = /url\((https:\/\/[^)]+\.(?:ttf|otf))\)/.exec(body)?.[1];
    if (!family || !Number.isFinite(weight) || !url) continue;
    faces.push({ family, weight, italic: style === "italic", url });
  }
  return faces;
}

// ─── manifest.json ───────────────────────────────────────────────────────────

export function readCustomFontManifest(): CustomFontFileEntry[] {
  try {
    const raw = fs.readFileSync(CUSTOM_MANIFEST_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CustomFontFileEntry[]) : [];
  } catch {
    return [];
  }
}

function writeCustomFontManifest(entries: CustomFontFileEntry[]): void {
  fs.mkdirSync(CUSTOM_DIR, { recursive: true });
  entries.sort((a, b) => a.family.localeCompare(b.family));
  // Atomic-ish: write temp then rename so renderers never read a torn file.
  const tmp = `${CUSTOM_MANIFEST_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2));
  fs.renameSync(tmp, CUSTOM_MANIFEST_PATH);
}

// ─── Install path ────────────────────────────────────────────────────────────

/** v1: single-weight static upright TTFs only — no italics. */
function fileNameFor(family: string, weight: number): string {
  const prefix = family.replace(/[^A-Za-z0-9]+/g, "");
  const weightName = WEIGHT_NAMES[weight] ?? String(weight);
  return `${prefix}-${weightName}.ttf`;
}

function toFileEntry(row: {
  family: string;
  slug: string | null;
  weights: number[];
  files: unknown;
  license: string;
}): CustomFontFileEntry {
  return {
    family: row.family,
    slug: row.slug ?? slugifyFontFamily(row.family),
    weights: row.weights,
    italics: [],
    files: row.files as Record<string, string>,
    license: row.license,
    source: "custom",
  };
}

async function upsertCustomFontAsset(input: {
  family: string;
  slug: string;
  weight: number;
  relPath: string;
  license: string;
}): Promise<CustomFontFileEntry> {
  const existing = await prisma.fontAsset.findUnique({ where: { family: input.family } });
  const files = { ...((existing?.files as Record<string, string> | null) ?? {}) };
  files[String(input.weight)] = input.relPath;
  const weights = Array.from(new Set([...(existing?.weights ?? []), input.weight])).sort(
    (a, b) => a - b,
  );
  const row = await prisma.fontAsset.upsert({
    where: { family: input.family },
    update: { slug: input.slug, weights, files, license: input.license, source: "custom" },
    create: {
      family: input.family,
      slug: input.slug,
      weights,
      files,
      license: input.license,
      source: "custom",
    },
  });

  // Rewrite the render-path index from the full custom set.
  const customRows = await prisma.fontAsset.findMany({ where: { source: "custom" } });
  writeCustomFontManifest(customRows.map(toFileEntry));
  return toFileEntry(row);
}

/**
 * Re-downloads any custom font files that are missing locally (e.g. after a
 * container rebuild) from R2. No-op when R2 is not configured or all files
 * are present.
 */
export async function ensureCustomFontsHydrated(): Promise<void> {
  const rows = await prisma.fontAsset.findMany({ where: { source: "custom" } });
  for (const row of rows) {
    const files = (row.files as Record<string, string> | null) ?? {};
    for (const relPath of Object.values(files)) {
      const absPath = path.join(process.cwd(), "public", relPath);
      if (fs.existsSync(absPath)) continue;
      const ok = await downloadFromR2(relPath, absPath);
      if (!ok) {
        console.warn(`[Custom Fonts] Missing local file and R2 rehydration failed: ${relPath}`);
      }
    }
  }
}

async function installTtf(
  buffer: Buffer,
  family: string,
  weight: number,
  license: string,
): Promise<MergedFontManifestEntry> {
  if (!isTtfBuffer(buffer)) {
    throw new FontInstallError("Not a TTF/OTF file (bad magic bytes).");
  }
  if (buffer.length > MAX_FONT_BYTES) {
    throw new FontInstallError("Font too large (max 5MB).");
  }
  const slug = slugifyFontFamily(family);
  if (!slug) throw new FontInstallError("Family name produces an empty slug.");
  const bundled = FONT_MANIFEST.find((f) => normalizeFamily(f.family) === normalizeFamily(family));
  if (bundled) {
    throw new FontInstallError(`"${family}" conflicts with a bundled font — it is already available.`);
  }

  const fileName = fileNameFor(family, weight);
  const dir = path.join(CUSTOM_DIR, slug);
  fs.mkdirSync(dir, { recursive: true });
  const absPath = path.join(dir, fileName);
  fs.writeFileSync(absPath, buffer);
  const relPath = `fonts/custom/${slug}/${fileName}`;

  // Mirror to R2 so the font survives container rebuilds (no-op when unconfigured).
  await uploadToR2(absPath, relPath, "font/ttf");

  const entry = await upsertCustomFontAsset({ family, slug, weight, relPath, license });
  return {
    family: entry.family,
    slug: entry.slug,
    weights: entry.weights,
    italics: entry.italics,
    license: entry.license,
    source: "custom",
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Registers a user-uploaded TTF. Validates magic bytes and size, slugifies
 * the family, installs to public/fonts/custom/<slug>/, mirrors to R2.
 */
export async function registerUploadedFont(
  buffer: Buffer,
  familyName: string,
  weight: number = DEFAULT_WEIGHT,
): Promise<MergedFontManifestEntry> {
  const family = familyName.trim();
  if (!family) throw new FontInstallError("familyName is required.");
  if (!WEIGHT_NAMES[weight]) {
    throw new FontInstallError(`Unsupported weight ${weight} — use a multiple of 100 (100–900).`);
  }
  return installTtf(buffer, family, weight, "custom");
}

interface GoogleFontInfo {
  family: string;
  faces: GoogleFontFace[];
}

/**
 * Resolves a family name against Google Fonts (css2 API). Exact match on the
 * normalized name (plus the small FAMILY_ALIASES map) — returns null rather
 * than substituting a different font.
 */
export async function findGoogleFont(familyName: string): Promise<GoogleFontInfo | null> {
  const requested = familyName.trim();
  if (!requested) return null;
  const canonical = FAMILY_ALIASES[normalizeFontName(requested)] ?? requested;

  // css2 requires an explicit axis list to return non-400 weights; asking for
  // the full range returns every weight the family actually ships.
  const url =
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(canonical)}` +
    `:wght@100;200;300;400;500;600;700;800;900`;
  const res = await fetch(url, {
    // An ancient UA makes Google serve plain TTF URLs instead of woff2.
    headers: { "User-Agent": "Mozilla/4.0 (compatible; MSIE 8.0; Windows NT 6.1)" },
  });
  if (!res.ok) return null; // unknown family → css2 answers 400
  const faces = parseGoogleFontsCss(await res.text());
  if (faces.length === 0) return null;
  // Guard: the served family must be exactly what we asked for.
  if (normalizeFontName(faces[0].family) !== normalizeFontName(canonical)) return null;
  return { family: faces[0].family, faces: faces.filter((f) => !f.italic) };
}

/** In-flight installs keyed by normalized family+weight — dedupes concurrent calls. */
const inFlightInstalls = new Map<string, Promise<MergedFontManifestEntry | null>>();

/**
 * Downloads a Google Font and installs it as a custom font. Idempotent: an
 * already-installed family returns the existing entry without any network
 * call. Returns null when the family is not on Google Fonts.
 */
export async function installGoogleFont(
  familyName: string,
  weight: number = DEFAULT_WEIGHT,
): Promise<MergedFontManifestEntry | null> {
  const key = `${normalizeFontName(familyName)}:${weight}`;
  const existing = inFlightInstalls.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<MergedFontManifestEntry | null> => {
    // Idempotent fast path — already installed (possibly on a previous deploy;
    // rehydrate from R2 if the local file went missing).
    const customRows = await prisma.fontAsset.findMany({ where: { source: "custom" } });
    const match = customRows.find((r) => normalizeFamily(r.family) === normalizeFamily(familyName));
    if (match) {
      await ensureCustomFontsHydrated();
      const entry = toFileEntry(match);
      return {
        family: entry.family,
        slug: entry.slug,
        weights: entry.weights,
        italics: entry.italics,
        license: entry.license,
        source: "custom",
      };
    }

    const found = await findGoogleFont(familyName);
    if (!found) return null;

    // Snap to the nearest weight the family actually ships.
    const available = found.faces.map((f) => f.weight);
    const resolved = available.reduce((best, w) =>
      Math.abs(w - weight) < Math.abs(best - weight) ? w : best,
    );
    const face = found.faces.find((f) => f.weight === resolved)!;
    const ttfRes = await fetch(face.url);
    if (!ttfRes.ok) {
      throw new FontInstallError(`Failed to download TTF for "${found.family}" (${ttfRes.status}).`);
    }
    const buffer = Buffer.from(await ttfRes.arrayBuffer());
    return installTtf(buffer, found.family, resolved, "OFL-1.1");
  })();

  inFlightInstalls.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlightInstalls.delete(key);
  }
}

/**
 * Bundled FONT_MANIFEST + custom FontAsset rows, in the same shape as the
 * existing GET /api/style-lab/fonts response (plus slug/source). Rehydrates
 * missing local files from R2 first.
 */
export async function getMergedFontManifest(): Promise<MergedFontManifestEntry[]> {
  await ensureCustomFontsHydrated();
  const customRows = await prisma.fontAsset.findMany({
    where: { source: "custom" },
    orderBy: { family: "asc" },
  });
  // Self-heal the render-path index if it is missing or drifted from the DB
  // (e.g. fresh container where only the DB rows came back).
  const entries = customRows.map(toFileEntry);
  if (JSON.stringify(readCustomFontManifest()) !== JSON.stringify(entries)) {
    writeCustomFontManifest(entries);
  }
  const bundled: MergedFontManifestEntry[] = FONT_MANIFEST.map((f) => ({
    family: f.family,
    slug: f.slug,
    weights: f.weights,
    italics: f.italics,
    license: f.license,
    source: "bundled",
  }));
  const custom: MergedFontManifestEntry[] = entries.map((entry) => ({
    family: entry.family,
    slug: entry.slug,
    weights: entry.weights,
    italics: entry.italics,
    license: entry.license,
    source: "custom",
  }));
  return [...bundled, ...custom];
}
