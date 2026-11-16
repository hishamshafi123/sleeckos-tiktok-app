import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getFontFile } from "@/lib/fonts";
import {
  MixerError,
  type MixerLayout,
  type MixerSettings,
} from "@/lib/campaign-mixer/schema";

export const MIXER_ROOT = path.resolve(
  process.env.MIXER_STORAGE_DIR ||
    path.join(process.cwd(), "data", "campaign-mixer"),
);
export function mixerPath(relative: string): string {
  const p = path.resolve(MIXER_ROOT, relative);
  if (!relative || p === MIXER_ROOT || !p.startsWith(MIXER_ROOT + path.sep))
    throw new MixerError("Invalid media location.");
  return p;
}
export function hash(value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}
export async function fileHash(file: string): Promise<string> {
  const h = crypto.createHash("sha256");
  for await (const part of fs.createReadStream(file)) h.update(part);
  return h.digest("hex");
}
export async function mediaCommand(
  command: string,
  args: string[],
  input?: string,
  timeout = 180_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "",
      stderr = "",
      timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeout);
    child.stdout.on("data", (d) => {
      stdout += d;
      if (stdout.length > 16_000_000) child.kill("SIGKILL");
    });
    child.stderr.on("data", (d) => {
      stderr = (stderr + d).slice(-4000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(
        new MixerError(
          `Media tool could not start: ${error.message}`,
          "MEDIA_TOOL",
          500,
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else
        reject(
          new MixerError(
            timedOut
              ? "Media processing timed out. Try a shorter clip."
              : `Media processing failed: ${stderr.slice(-650) || `exit ${code}`}`,
            "MEDIA_FAILED",
            422,
          ),
        );
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
export async function probe(file: string) {
  const raw = await mediaCommand("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration,size:stream=codec_type,codec_name,width,height,duration:stream_tags=rotate:stream_side_data=rotation",
    "-of",
    "json",
    file,
  ]);
  const info = JSON.parse(raw) as {
    streams?: {
      codec_type: string;
      codec_name: string;
      width?: number;
      height?: number;
      duration?: string;
      tags?: { rotate?: string };
      side_data_list?: { rotation?: number }[];
    }[];
    format?: { duration?: string; size?: string };
  };
  const video = info.streams?.find((s) => s.codec_type === "video");
  const rotation = Number(
    video?.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ??
      video?.tags?.rotate ??
      0,
  );
  return {
    duration: Number(info.format?.duration),
    bytes: Number(info.format?.size),
    video,
    hasAudio: !!info.streams?.some((s) => s.codec_type === "audio"),
    width: Math.abs(rotation % 180) === 90 ? video?.height : video?.width,
    height: Math.abs(rotation % 180) === 90 ? video?.width : video?.height,
  };
}
export async function checkSpace(estimatedBytes = 0) {
  for (const directory of [
    MIXER_ROOT,
    path.join(process.cwd(), "public/uploads/multiplier/outputs"),
  ]) {
    await fs.promises.mkdir(directory, { recursive: true });
    const info = await fs.promises.statfs(directory);
    if (info.bavail * info.bsize < 1024 ** 3 + estimatedBytes)
      throw new MixerError(
        "Storage is nearly full. Free space or reduce the batch before continuing. Your saved library is retained.",
        "STORAGE_LOW",
        507,
      );
  }
}

/** Only disposable caches/samples are pruned. Libraries and delivery history persist. */
export async function cleanupMixerTemporaryFiles() {
  const result = { deleted: 0, failed: 0, skipped: 0 };
  const locations = [
    {
      dir: mixerPath("incoming"),
      age: 86400000,
      matches: (name: string) => name.endsWith(".tmp"),
    },
    {
      dir: mixerPath("captions"),
      age: 7 * 86400000,
      matches: (name: string) => /^[a-f0-9]{64}\.(png|json)$/.test(name),
    },
    {
      dir: path.join(process.cwd(), "public/uploads/multiplier/outputs"),
      age: 86400000,
      matches: (name: string) =>
        name.startsWith("mix_sample_") && name.endsWith(".mp4"),
    },
  ];
  for (const location of locations) {
    const files = await fs.promises
      .readdir(location.dir, { withFileTypes: true })
      .catch(() => []);
    for (const file of files) {
      if (!file.isFile() || !location.matches(file.name)) continue;
      try {
        const target = path.join(location.dir, file.name),
          stat = await fs.promises.stat(target);
        if (stat.mtimeMs > Date.now() - location.age) {
          result.skipped++;
          continue;
        }
        await fs.promises.unlink(target);
        result.deleted++;
      } catch {
        result.failed++;
      }
    }
  }
  return result;
}
export async function receiveUpload(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
) {
  if (!body) throw new MixerError("Choose a file to upload.");
  await checkSpace(maxBytes);
  const relative = `incoming/${crypto.randomUUID()}.tmp`,
    file = mixerPath(relative);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  let bytes = 0;
  const limit = new Transform({
    transform(chunk, _encoding, cb) {
      bytes += chunk.length;
      cb(
        bytes > maxBytes
          ? new MixerError(
              `This file exceeds the ${Math.round(maxBytes / 1024 ** 2)} MB upload limit.`,
              "FILE_TOO_LARGE",
              413,
            )
          : null,
        chunk,
      );
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(body as never),
      limit,
      fs.createWriteStream(file, { flags: "wx" }),
    );
    if (!bytes) throw new MixerError("The uploaded file is empty.");
    return { file, bytes };
  } catch (e) {
    await fs.promises.unlink(file).catch(() => {});
    throw e;
  }
}
export async function prepareAsset(
  file: string,
  id: string,
  kind: "clip" | "music",
) {
  const info = await probe(file);
  if (
    !Number.isFinite(info.duration) ||
    info.duration < 1 ||
    info.duration > (kind === "clip" ? 180 : 1800)
  )
    throw new MixerError(
      kind === "clip"
        ? "Upload a clip between 1 and 180 seconds."
        : "Upload music between 1 second and 30 minutes.",
      "INVALID_DURATION",
    );
  if (kind === "clip" && !info.video)
    throw new MixerError("This file has no video stream.", "INVALID_MEDIA");
  if (kind === "music" && !info.hasAudio)
    throw new MixerError("This file has no audio stream.", "INVALID_MEDIA");
  const base = `assets/${id}`,
    original = `${base}/original.bin`,
    preview = `${base}/preview.${kind === "clip" ? "mp4" : "m4a"}`;
  await fs.promises.mkdir(mixerPath(base), { recursive: true });
  await fs.promises.rename(file, mixerPath(original));
  const common = ["-y", "-v", "error", "-i", mixerPath(original)];
  try {
    if (kind === "clip") {
      await mediaCommand("ffmpeg", [
        ...common,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-vf",
        "scale=-2:720",
        "-c:v",
        "libx264",
        "-threads",
        "2",
        "-preset",
        "veryfast",
        "-crf",
        "25",
        "-pix_fmt",
        "yuv420p",
        "-r",
        "30",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        mixerPath(preview),
      ]);
      await mediaCommand("ffmpeg", [
        "-y",
        "-v",
        "error",
        "-ss",
        String(Math.min(1, info.duration / 2)),
        "-i",
        mixerPath(preview),
        "-frames:v",
        "1",
        "-vf",
        "scale=-2:320",
        mixerPath(`${base}/thumb.jpg`),
      ]);
    } else {
      await mediaCommand("ffmpeg", [
        ...common,
        "-vn",
        "-af",
        "loudnorm=I=-16:TP=-1.5:LRA=11",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        mixerPath(preview),
      ]);
    }
    return {
      filePath: original,
      previewPath: preview,
      thumbnailPath: kind === "clip" ? `${base}/thumb.jpg` : null,
      duration: info.duration,
      width: info.width ?? null,
      height: info.height ?? null,
      hasAudio: info.hasAudio,
    };
  } catch (e) {
    await fs.promises.rm(mixerPath(base), { recursive: true, force: true });
    throw e;
  }
}

type LayoutRequest = { key: string; text: string; settings: MixerSettings };
export async function prepareLayouts(
  requests: LayoutRequest[],
): Promise<Map<string, MixerLayout | string>> {
  const result = new Map<string, MixerLayout | string>();
  const tasks: {
    key: string;
    text: string;
    font: string;
    size: number;
    position: string;
    align: string;
    output: string;
    relative: string;
    fontHash: string;
  }[] = [];
  const fonts = new Map<string, { file: string; digest: string }>();
  for (const r of requests) {
    const fontKey = `${r.settings.fontFamily}:${r.settings.fontWeight}`;
    let font = fonts.get(fontKey);
    if (!font) {
      const relative = getFontFile(
        r.settings.fontFamily,
        r.settings.fontWeight,
      );
      if (!relative)
        throw new MixerError(
          `Font ${fontKey} is not installed. Choose another font.`,
          "FONT_MISSING",
        );
      const file = path.join(process.cwd(), "public", relative);
      try {
        font = { file, digest: await fileHash(file) };
      } catch {
        throw new MixerError(
          `Font ${fontKey} is missing. Restore the font before rendering.`,
          "FONT_MISSING",
        );
      }
      fonts.set(fontKey, font);
    }
    const identity = hash({
      v: 1,
      text: r.text,
      font: font.digest,
      size: r.settings.fontSize,
      position: r.settings.position,
      align: r.settings.align,
    });
    const relative = `captions/${identity}.png`,
      metadata = mixerPath(`captions/${identity}.json`);
    try {
      const saved = JSON.parse(
        await fs.promises.readFile(metadata, "utf8"),
      ) as MixerLayout;
      await fs.promises.access(mixerPath(relative));
      result.set(r.key, saved);
      continue;
    } catch {
      /* produce the missing cache entry */
    }
    tasks.push({
      key: r.key,
      text: r.text,
      font: font.file,
      size: r.settings.fontSize,
      position: r.settings.position,
      align: r.settings.align,
      output: mixerPath(relative),
      relative,
      fontHash: font.digest,
    });
  }
  if (tasks.length) {
    const python = fs.existsSync(path.join(process.cwd(), "venv/bin/python3"))
      ? path.join(process.cwd(), "venv/bin/python3")
      : "python3";
    const raw = await mediaCommand(
      python,
      [path.join(process.cwd(), "scripts/mixer_caption.py")],
      JSON.stringify(tasks),
      180_000,
    );
    const layouts = JSON.parse(raw) as (Omit<
      MixerLayout,
      "path" | "fontHash"
    > & { key: string; error?: string })[];
    for (let i = 0; i < layouts.length; i++) {
      const l = layouts[i],
        task = tasks[i];
      if (l.error) result.set(l.key, l.error);
      else {
        const value: MixerLayout = {
          path: task.relative,
          fontHash: task.fontHash,
          fontSize: l.fontSize,
          lines: l.lines,
          box: l.box,
        };
        await fs.promises.writeFile(
          mixerPath(task.relative.replace(/\.png$/, ".json")),
          JSON.stringify(value),
        );
        result.set(l.key, value);
      }
    }
  }
  return result;
}
