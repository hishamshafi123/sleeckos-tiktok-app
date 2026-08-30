import { continueRender, delayRender, staticFile } from "remotion";
import { FONT_MANIFEST } from "../lib/fonts";

/**
 * Registers every bundled self-hosted font (see src/lib/fonts.ts) with the
 * browser via the FontFace API, loading the actual TTFs from `public/fonts/`
 * through Remotion's staticFile(). This makes rendering fully deterministic
 * and offline-capable — no Google Fonts CDN requests at render time — and
 * identical between preview and still/video renders, since both evaluate
 * this module through the same root (src/remotion/index.ts).
 *
 * Compositions simply use the manifest family name in CSS, e.g.
 *   style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontWeight: 600 }}
 * Any family + weight (+ italic, where bundled) in FONT_MANIFEST resolves.
 */

let registered = false;

/** Mirrors CustomFontFileEntry in src/lib/services/custom-fonts.ts — the
 * writer of public/fonts/custom/manifest.json. Declared locally so this
 * module stays Prisma-free (it is bundled into the Remotion browser build). */
interface CustomFontFileEntry {
  family: string;
  slug: string;
  weights: number[];
  italics: number[];
  files: Record<string, string>;
  license: string;
  source: "custom";
}

function addFace(family: string, relPath: string, weight: number, italic: boolean): Promise<void> {
  const face = new FontFace(family, `url('${staticFile(relPath)}') format('truetype')`, {
    weight: String(weight),
    style: italic ? "italic" : "normal",
    display: "block",
  });
  return face.load().then((loaded) => {
    document.fonts.add(loaded);
  });
}

/**
 * Loads runtime-installed custom fonts (uploads / Google Fonts auto-fetch —
 * see src/lib/services/custom-fonts.ts) from the maintained JSON index.
 * Served through staticFile like the bundled TTFs; a missing or unreadable
 * index just means no custom fonts — never fatal.
 */
async function loadCustomFontFaces(): Promise<Promise<void>[]> {
  try {
    const res = await fetch(staticFile("fonts/custom/manifest.json"));
    if (!res.ok) return [];
    const entries = (await res.json()) as CustomFontFileEntry[];
    if (!Array.isArray(entries)) return [];
    const loaders: Promise<void>[] = [];
    for (const entry of entries) {
      for (const [key, relPath] of Object.entries(entry.files ?? {})) {
        const italic = key.endsWith("i");
        const weight = Number(italic ? key.slice(0, -1) : key);
        if (!Number.isFinite(weight)) continue;
        loaders.push(addFace(entry.family, relPath, weight, italic));
      }
    }
    return loaders;
  } catch {
    return [];
  }
}

export function registerBundledFonts(): void {
  if (registered) return;
  registered = true;
  // Skip during the Node/bundling phase — FontFace only exists in the browser.
  if (typeof document === "undefined") return;

  const handle = delayRender("Loading bundled self-hosted fonts");

  const loaders: Promise<void>[] = [];
  for (const entry of FONT_MANIFEST) {
    for (const weight of entry.weights) {
      loaders.push(addFace(entry.family, entry.fileFor(weight), weight, false));
    }
    for (const weight of entry.italics) {
      loaders.push(addFace(entry.family, entry.fileFor(weight, true), weight, true));
    }
  }

  loadCustomFontFaces()
    .then((customLoaders) => Promise.all([...loaders, ...customLoaders]))
    .then(() => continueRender(handle))
    .catch((err) => {
      // Never wedge the render on a font failure — fall back to system fonts.
      console.warn("[Remotion] Failed to load bundled fonts:", err);
      continueRender(handle);
    });
}
