import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { SAMPLE_LYRIC_LINES } from "../src/lib/style-lab/schema";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PLACEHOLDER_DATABASE_URL = "postgresql://canary:canary@127.0.0.1:65432/canary";
const STYLE_ID = "editorial-caption";
const MULTIPLIER_DIR = path.join(ROOT, "public", "uploads", "multiplier");
const VARIATIONS_DIR = path.join(MULTIPLIER_DIR, "variations");
const STILLS_DIR = path.join(MULTIPLIER_DIR, "stills");
const OUTPUTS_DIR = path.join(MULTIPLIER_DIR, "outputs");

async function run(command: string, args: string[]) {
  try {
    return await execFileAsync(command, args, { maxBuffer: 8 * 1024 * 1024 });
  } catch (error) {
    const err = error as { message?: string; stderr?: string };
    throw new Error(`${command} failed: ${err.message || error}\n${err.stderr || ""}`);
  }
}

async function main() {
  const startedAt = Date.now();
  const runId = `${Date.now()}_${process.pid}_${crypto.randomUUID().replaceAll("-", "")}`;
  const outputIds = Array.from({ length: 4 }, (_, index) => `canary_${runId}_${index + 1}`);
  const captions = outputIds.map((id, index) => `Canary caption ${index + 1}: ${id}`);
  const sourcePath = path.join(VARIATIONS_DIR, `canary_${runId}.mp4`);
  const sourceRef = `/uploads/multiplier/variations/${path.basename(sourcePath)}`;
  const stillPaths = outputIds.map((id) => path.join(STILLS_DIR, `still_${id}.png`));
  const outputPaths = outputIds.map((id) => path.join(OUTPUTS_DIR, `multi_${id}.mp4`));
  const settings: Record<string, unknown> = {};
  const cachePaths = captions.map((caption) => {
    const inputProps = {
      ...settings,
      lines: SAMPLE_LYRIC_LINES,
      quoteText: caption,
      text: caption,
      author: "",
    };
    const hash = crypto
      .createHash("sha256")
      .update(JSON.stringify({ v: 1, styleId: STYLE_ID, compositionId: STYLE_ID, inputProps }))
      .digest("hex");
    return path.join(STILLS_DIR, `still_cache_${hash}.png`);
  });
  const ownedFiles = new Set<string>();
  const reserve = (filePath: string) => {
    if (fs.existsSync(filePath)) {
      throw new Error(`Refusing to overwrite pre-existing file: ${filePath}`);
    }
    ownedFiles.add(filePath);
  };

  try {
    await Promise.all(
      [VARIATIONS_DIR, STILLS_DIR, OUTPUTS_DIR].map((dir) =>
        fs.promises.mkdir(dir, { recursive: true })
      )
    );
    for (const filePath of [sourcePath, ...stillPaths, ...outputPaths, ...cachePaths]) {
      reserve(filePath);
    }

    process.env.DATABASE_URL = PLACEHOLDER_DATABASE_URL;
    process.env.PUPPETEER_EXECUTABLE_PATH = CHROME_PATH;
    for (const key of [
      "R2_ACCOUNT_ID",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_BUCKET_NAME",
    ]) {
      delete process.env[key];
    }

    const { composeOutput, renderCaptionStill } = await import("../src/lib/services/multiplier");

    console.log(`[canary] run_id=${runId}`);
    await run("ffmpeg", [
      "-y",
      "-v", "error",
      "-f", "lavfi",
      "-i", "testsrc2=size=720x1280:rate=30",
      "-f", "lavfi",
      "-i", "sine=frequency=660:sample_rate=48000",
      "-t", "1",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-shortest",
      "-movflags", "+faststart",
      sourcePath,
    ]);

    const stillsStartedAt = Date.now();
    const renderedStills = await Promise.all(
      captions.map((caption, index) =>
        renderCaptionStill(STYLE_ID, caption, settings, outputIds[index])
      )
    );
    for (let index = 0; index < renderedStills.length; index++) {
      if (renderedStills[index] !== stillPaths[index]) {
        throw new Error(`Unexpected still path: ${renderedStills[index]}`);
      }
      if ((await fs.promises.stat(renderedStills[index])).size <= 1024) {
        throw new Error(`Caption still is empty or too small: ${renderedStills[index]}`);
      }
    }
    console.log(`[canary] four unique cache-miss stills passed in ${Date.now() - stillsStartedAt}ms`);

    const composeStartedAt = Date.now();
    const outputRefs = await Promise.all(
      renderedStills.map((stillPath, index) =>
        composeOutput(sourceRef, stillPath, outputIds[index], settings)
      )
    );
    for (let index = 0; index < outputRefs.length; index++) {
      const outputPath = path.join(ROOT, "public", outputRefs[index]);
      if (outputPath !== outputPaths[index]) {
        throw new Error(`Unexpected output path: ${outputRefs[index]}`);
      }
    }
    console.log(`[canary] four concurrent compositions finished in ${Date.now() - composeStartedAt}ms`);

    const results = await Promise.all(outputPaths.map(async (outputPath) => {
      const { stdout } = await run("ffprobe", [
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-show_entries", "format=size",
        "-of", "json",
        outputPath,
      ]);
      const probe = JSON.parse(stdout) as {
        streams?: { width?: number; height?: number }[];
        format?: { size?: string };
      };
      const video = probe.streams?.[0];
      const bytes = (await fs.promises.stat(outputPath)).size;
      if (!video || video.width !== 720 || video.height !== 1280) {
        throw new Error(`Invalid dimensions for ${outputPath}: ${JSON.stringify(probe)}`);
      }
      if (bytes <= 0 || Number(probe.format?.size || 0) <= 0) {
        throw new Error(`Empty video output: ${outputPath}`);
      }
      return { file: path.basename(outputPath), bytes, width: video.width, height: video.height };
    }));

    for (const result of results) {
      console.log(
        `[canary] verified ${result.file}: ${result.width}x${result.height}, ${result.bytes} bytes`
      );
    }
    console.log(`[canary] PASS: 4 stills, 4 videos, all outputs nonempty 720x1280`);
  } finally {
    const filesInStills = await fs.promises.readdir(STILLS_DIR).catch(() => [] as string[]);
    for (const cachePath of cachePaths) {
      const tempPrefix = `${path.basename(cachePath, ".png")}.${process.pid}.`;
      for (const fileName of filesInStills) {
        if (fileName.startsWith(tempPrefix) && fileName.endsWith(".tmp.png")) {
          ownedFiles.add(path.join(STILLS_DIR, fileName));
        }
      }
    }

    const cleanupErrors: string[] = [];
    for (const filePath of ownedFiles) {
      try {
        await fs.promises.unlink(filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          cleanupErrors.push(`${filePath}: ${error}`);
        }
      }
    }
    if (cleanupErrors.length > 0) {
      process.exitCode = 1;
      console.error(`[canary] cleanup failures:\n${cleanupErrors.join("\n")}`);
    }
    console.log(`[canary] cleanup complete; wall_time_ms=${Date.now() - startedAt}`);
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error(`[canary] FAIL:`, error);
    process.exit(1);
  });
