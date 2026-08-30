import { bundle } from "@remotion/bundler";
import fs from "fs";
import path from "path";

let cachedBundleLocation: string | null = null;

/**
 * Shared Remotion bundle for every render service (Style Lab, Style Studio,
 * Video Factory). bundle() copies public/ into the bundle by default — and
 * public/uploads is a multi-GB render volume, which produced ~51GB bundles
 * (two of them filled the VPS disk). symlinkPublicDir links public/ into the
 * bundle instead of copying, so bundles stay small while staticFile()
 * (fonts, layer images) keeps resolving. Bundles are throwaway,
 * container-local artifacts, so the symlink is safe.
 */
export async function getRemotionBundle(): Promise<string> {
  if (cachedBundleLocation && fs.existsSync(cachedBundleLocation)) {
    return cachedBundleLocation;
  }
  const entryPoint = path.join(process.cwd(), "src", "remotion", "index.ts");
  cachedBundleLocation = await bundle(entryPoint, undefined, { symlinkPublicDir: true });
  return cachedBundleLocation;
}

/** Current cached bundle dir, or null when nothing is cached. Never bundles. */
export function getCachedRemotionBundleLocation(): string | null {
  return cachedBundleLocation && fs.existsSync(cachedBundleLocation)
    ? cachedBundleLocation
    : null;
}

/**
 * Drops the cached bundle location so the next getRemotionBundle() re-bundles.
 * Style Match calls this when a runtime-installed font is NOT visible inside
 * the cached bundle (a safety net — with symlinkPublicDir the bundle serves
 * public/ through a symlink, so freshly installed fonts are normally visible
 * without a re-bundle).
 */
export function invalidateRemotionBundleCache(): void {
  cachedBundleLocation = null;
}
