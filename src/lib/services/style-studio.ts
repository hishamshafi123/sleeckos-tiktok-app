import prisma from "@/lib/db";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import path from "path";
import fs from "fs";
import { uploadToR2 } from "./storage";

export interface StyleParamField {
  key: string;
  label: string;
  type: "text" | "color" | "number" | "boolean";
  defaultValue: any;
  min?: number;
  max?: number;
}

const defaultTemplates: { key: string; name: string; engine: string; paramSchema: string }[] = [
  {
    key: "brat",
    name: "Brat (Charli XCX style)",
    engine: "remotion",
    paramSchema: JSON.stringify([
      { key: "text", label: "Custom Text", type: "text", defaultValue: "brat" },
      { key: "textColor", label: "Text Color", type: "color", defaultValue: "#000000" },
      { key: "bgColor", label: "Background Color", type: "color", defaultValue: "#8ace00" },
      { key: "fontSize", label: "Font Size (px)", type: "number", defaultValue: 90, min: 40, max: 200 },
      { key: "blur", label: "Blur Level (px)", type: "number", defaultValue: 2, min: 0, max: 10 },
      { key: "isItalic", label: "Italic style", type: "boolean", defaultValue: true },
      { key: "isBold", label: "Bold style", type: "boolean", defaultValue: true },
    ]),
  },
  {
    key: "spotify-lyrics",
    name: "Spotify Lyrics Card",
    engine: "remotion",
    paramSchema: JSON.stringify([
      { key: "textColor", label: "Text Color", type: "color", defaultValue: "#ffffff" },
      { key: "activeTextColor", label: "Active Highlight Color", type: "color", defaultValue: "#1db954" },
      { key: "fontSize", label: "Font Size (px)", type: "number", defaultValue: 32, min: 16, max: 64 },
      { key: "albumArtUrl", label: "Album Art (Optional)", type: "text", defaultValue: "" },
      { key: "showProgressBar", label: "Show Progress Bar", type: "boolean", defaultValue: true },
    ]),
  },
  {
    key: "quote",
    name: "Animated Minimal Quote",
    engine: "remotion",
    paramSchema: JSON.stringify([
      { key: "quoteText", label: "Quote Text", type: "text", defaultValue: "Be yourself; everyone else is already taken." },
      { key: "author", label: "Author", type: "text", defaultValue: "Oscar Wilde" },
      { key: "textColor", label: "Text Color", type: "color", defaultValue: "#ffffff" },
      { key: "bgColor", label: "Background Color (Transparent/Solid)", type: "color", defaultValue: "transparent" },
      { key: "fontSize", label: "Font Size (px)", type: "number", defaultValue: 28, min: 14, max: 60 },
      { key: "animationSpeed", label: "Animation Speed (x)", type: "number", defaultValue: 1, min: 0.5, max: 2.0 },
    ]),
  }
];

/**
 * Seed default templates in the database if they don't exist
 */
export async function seedDefaultStyleTemplates() {
  for (const t of defaultTemplates) {
    const existing = await prisma.styleTemplate.findUnique({
      where: { key: t.key }
    });
    if (!existing) {
      await prisma.styleTemplate.create({
        data: {
          key: t.key,
          name: t.name,
          engine: t.engine,
          paramSchema: t.paramSchema,
        }
      });
    }
  }
}

/**
 * Get all available Style Templates (seeds defaults on first call)
 */
export async function getStyleTemplates() {
  await seedDefaultStyleTemplates();
  return prisma.styleTemplate.findMany({
    orderBy: { createdAt: "asc" }
  });
}

/**
 * Register a new Style Template (Admin Only)
 */
export async function createStyleTemplate(data: {
  key: string;
  name: string;
  engine: string;
  paramSchema: string;
  thumbnail?: string;
  createdBy?: string;
}) {
  return prisma.styleTemplate.create({
    data
  });
}

/**
 * Get all configured Saved Styles
 */
export async function getSavedStyles() {
  return prisma.savedStyle.findMany({
    orderBy: { createdAt: "desc" }
  });
}

/**
 * Save a new Style Preset
 */
export async function createSavedStyle(data: {
  templateKey: string;
  name: string;
  params: any;
  thumbnail?: string;
  createdBy?: string;
  tags?: string[];
}) {
  return prisma.savedStyle.create({
    data: {
      templateKey: data.templateKey,
      name: data.name,
      params: JSON.stringify(data.params),
      thumbnail: data.thumbnail,
      createdBy: data.createdBy,
      tags: data.tags || [],
    }
  });
}

/**
 * Update an existing Style Preset
 */
export async function updateSavedStyle(
  id: string,
  data: {
    name?: string;
    params?: any;
    thumbnail?: string;
    tags?: string[];
  }
) {
  const updateData: any = {};
  if (data.name) updateData.name = data.name;
  if (data.params) updateData.params = JSON.stringify(data.params);
  if (data.thumbnail) updateData.thumbnail = data.thumbnail;
  if (data.tags) updateData.tags = data.tags;

  return prisma.savedStyle.update({
    where: { id },
    data: updateData,
  });
}

/**
 * Delete a Saved Style Preset
 */
export async function deleteSavedStyle(id: string) {
  return prisma.savedStyle.delete({
    where: { id }
  });
}

/**
 * Queues a rendering test sample job
 */
export async function queueRenderJob(savedStyleId: string, inputProps: any) {
  const job = await prisma.styleRenderJob.create({
    data: {
      savedStyleId,
      status: "PENDING",
      inputProps: JSON.stringify(inputProps),
    }
  });

  // Trigger rendering worker loop asynchronously
  triggerRenderWorker();

  return job;
}

// Global bundle location cache to speed up dynamic rendering
let cachedBundleLocation: string | null = null;
let isWorkerRunning = false;

async function getBundle() {
  if (cachedBundleLocation && fs.existsSync(cachedBundleLocation)) {
    return cachedBundleLocation;
  }
  const entryPoint = path.join(process.cwd(), "src", "remotion", "index.ts");
  if (!fs.existsSync(entryPoint)) {
    // If not found, create a placeholder directory/file to prevent bundler failure
    const dir = path.dirname(entryPoint);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(entryPoint, `import { registerRoot } from "remotion";\nregisterRoot(() => null);\n`);
  }
  console.log(`[Remotion Worker] Bundling entry point: ${entryPoint}`);
  cachedBundleLocation = await bundle(entryPoint);
  return cachedBundleLocation;
}

/**
 * Start the background worker queue if not already running
 */
export function triggerRenderWorker() {
  if (isWorkerRunning) return;
  isWorkerRunning = true;
  
  processQueue().finally(() => {
    isWorkerRunning = false;
  });
}

/**
 * Sequential background worker loop (concurrency 1-2)
 */
async function processQueue() {
  console.log("[Remotion Worker] Starting queued job runner...");
  
  while (true) {
    // Get next PENDING job
    const job = await prisma.styleRenderJob.findFirst({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" }
    });

    if (!job) {
      console.log("[Remotion Worker] Queue empty. Going to sleep.");
      break;
    }

    // Lock job status
    await prisma.styleRenderJob.update({
      where: { id: job.id },
      data: { status: "PROCESSING" }
    });

    try {
      console.log(`[Remotion Worker] Starting render for Job ID: ${job.id}`);
      
      const savedStyle = await prisma.savedStyle.findUnique({
        where: { id: job.savedStyleId }
      });

      if (!savedStyle) {
        throw new Error(`SavedStyle ID ${job.savedStyleId} not found in DB`);
      }

      // Merge saved parameters with custom input props (like text overrides)
      const savedParams = JSON.parse(savedStyle.params || "{}");
      const customProps = JSON.parse(job.inputProps || "{}");
      const inputProps = { ...savedParams, ...customProps };

      // Perform the actual render
      const outputUrl = await performRemotionRender(job.id, savedStyle.templateKey, inputProps);

      await prisma.styleRenderJob.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED",
          outputUrl
        }
      });
      console.log(`[Remotion Worker] Job ID ${job.id} completed successfully.`);
    } catch (err: any) {
      console.error(`[Remotion Worker] Job ID ${job.id} failed:`, err);
      await prisma.styleRenderJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          error: err.message || String(err)
        }
      });
    }
  }
}

/**
 * Invokes Remotion Programmatic renderer
 */
async function performRemotionRender(jobId: string, templateKey: string, inputProps: any): Promise<string> {
  const bundleLocation = await getBundle();
  
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: templateKey,
    inputProps,
  });

  const outputDir = path.join(process.cwd(), "public", "uploads", "style-renders");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Generate transparent VP9 WebM output to allow compositing downstream
  const fileName = `render_${jobId}.webm`;
  const localOutFile = path.join(outputDir, fileName);

  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    outputLocation: localOutFile,
    inputProps,
    codec: "vp9", // supports transparency alpha channel
    browserExecutable: process.env.PUPPETEER_EXECUTABLE_PATH || undefined, // maps to Chromium path in Docker
  });

  const relativeUrl = `/uploads/style-renders/${fileName}`;

  // Optionally offload to Cloudflare R2
  try {
    const r2Key = `uploads/style-renders/${fileName}`;
    await uploadToR2(localOutFile, r2Key);
  } catch (r2Err) {
    console.warn(`[Remotion Worker] Cloudflare R2 upload skipped/failed for ${fileName}:`, r2Err);
  }

  return relativeUrl;
}

/**
 * Retrieves a pre-rendered transparent VP9 WebM overlay from cache (disk or R2),
 * or renders it using Remotion if it does not exist.
 */
export async function getOrCreateOverlay(
  savedStyleId: string,
  templateKey: string,
  inputProps: any
): Promise<string> {
  const crypto = await import("crypto");
  const hashInput = JSON.stringify({ savedStyleId, templateKey, inputProps });
  const hash = crypto.createHash("sha256").update(hashInput).digest("hex");

  const outputDir = path.join(process.cwd(), "public", "uploads", "style-renders");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const fileName = `overlay_${hash}.webm`;
  const relativeUrl = `/uploads/style-renders/${fileName}`;
  const localOutFile = path.join(outputDir, fileName);
  const sentinelFile = localOutFile + ".ready";

  // Check cache (must exist, have ready sentinel, and be larger than 1KB)
  if (fs.existsSync(localOutFile) && fs.existsSync(sentinelFile)) {
    try {
      const stats = fs.statSync(localOutFile);
      if (stats.size > 1024) {
        console.log(`[Style Studio Overlay] Cache hit for overlay hash ${hash}. Reusing output.`);
        return relativeUrl;
      }
    } catch (err) {
      console.warn(`[Style Studio Overlay] Stale/corrupt cache check failed for ${hash}, re-rendering...`);
    }
  }

  console.log(`[Style Studio Overlay] Cache miss for overlay hash ${hash}. Rendering transparent WebM overlay via Remotion...`);
  
  const bundleLocation = await getBundle();
  
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: templateKey,
    inputProps,
  });

  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    outputLocation: localOutFile,
    inputProps,
    codec: "vp9", // transparency alpha support
    browserExecutable: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });

  // Write ready sentinel file
  fs.writeFileSync(sentinelFile, "ready", "utf-8");
  console.log(`[Style Studio Overlay] Finished rendering overlay: ${relativeUrl}`);

  // Upload to R2 in the background
  try {
    await uploadToR2(localOutFile, `uploads/style-renders/${fileName}`);
  } catch (r2Err) {
    console.warn(`[Style Studio Overlay] R2 upload failed for ${fileName}:`, r2Err);
  }

  return relativeUrl;
}

