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

  Promise.all(loaders)
    .then(() => continueRender(handle))
    .catch((err) => {
      // Never wedge the render on a font failure — fall back to system fonts.
      console.warn("[Remotion] Failed to load bundled fonts:", err);
      continueRender(handle);
    });
}
