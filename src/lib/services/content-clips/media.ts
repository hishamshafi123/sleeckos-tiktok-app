import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { resolve4 } from "node:dns/promises";
import { isIP } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isPublicIPv4 } from "../content-desk/network";
import { publicUrl } from "../content-desk/rules";
import { MAX_BYTES, MAX_SECONDS } from "../../content-clips/schema";
import { downloadTikTokVideo } from "../tiktok-download";
import {
  checkYouTubeInfo,
  rapidYouTubeRequest,
  selectYouTubeFormats,
} from "./youtube-rapidapi";
export const MEDIA_ROOT = path.resolve(
  process.env.CONTENT_CLIP_DIR || "data/content-clips",
);
export function mediaPath(relative: string) {
  if (!/^[a-zA-Z0-9_./-]+$/.test(relative))
    throw new Error("Invalid media path.");
  const file = path.resolve(MEDIA_ROOT, relative);
  if (!file.startsWith(MEDIA_ROOT + path.sep))
    throw new Error("Invalid media path.");
  return file;
}
export async function command(
  file: string,
  args: string[],
  timeout = 900000,
  signal?: AbortSignal,
) {
  return promisify(execFile)(file, args, {
    timeout,
    signal,
    maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, OMP_NUM_THREADS: "2" },
  });
}
export function videoSource(raw: string) {
  const url = new URL(publicUrl(raw));
  const host = url.hostname.replace(/^www\./, "");
  if (
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "youtu.be"
  ) {
    const id =
      host === "youtu.be"
        ? url.pathname.slice(1)
        : url.pathname.startsWith("/shorts/")
          ? url.pathname.split("/")[2]
          : url.searchParams.get("v");
    if (!id || !/^[\w-]{11}$/.test(id))
      throw new Error("Use a YouTube video link, not a channel or playlist.");
    return { kind: "youtube", url: `https://www.youtube.com/watch?v=${id}` };
  }
  if (host === "instagram.com") {
    const match = url.pathname.match(/^\/(reel|reels|p)\/([\w-]+)\/?$/);
    if (!match) throw new Error("Use an Instagram reel or post link.");
    return {
      kind: "instagram",
      url: `https://www.instagram.com/${match[1]}/${match[2]}/`,
    };
  }
  if (host === "tiktok.com") {
    if (!/^\/@[\w.-]+\/video\/\d+\/?$/.test(url.pathname))
      throw new Error("Use the full TikTok video link from its browser page.");
    return { kind: "tiktok", url: `https://www.tiktok.com${url.pathname}` };
  }
  if (/\.(mp4|mov|webm)$/i.test(url.pathname))
    return { kind: "direct", url: url.toString() };
  throw new Error(
    "Add a YouTube video, Instagram reel, TikTok video, direct MP4 link, or upload a video file.",
  );
}
async function downloadPublic(
  raw: string,
  dest: string,
  signal: AbortSignal,
  redirects = 0,
  options: { maxBytes?: number; userAgent?: string } = {},
): Promise<void> {
  const url = new URL(publicUrl(raw));
  const ips = isIP(url.hostname)
    ? [url.hostname]
    : await resolve4(url.hostname);
  if (!ips.length || ips.some((ip) => !isPublicIPv4(ip)))
    throw new Error("Use a public video URL.");
  await new Promise<void>((resolve, reject) => {
    const req = https.get(
      url,
      {
        signal,
        family: 4,
        headers: { "User-Agent": options.userAgent || "Sleeckos/1.0" },
        lookup: (_host, options, cb) => {
          if (options.all) cb(null, [{ address: ips[0], family: 4 }]);
          else cb(null, ips[0], 4);
        },
      },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          if (redirects >= 4) {
            reject(
              new Error("Too many video redirects. Upload the file instead."),
            );
            return;
          }
          downloadPublic(
            new URL(res.headers.location, url).toString(),
            dest,
            signal,
            redirects + 1,
            options,
          ).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(
            new Error(
              "The source cannot be downloaded. Try another link or upload the video.",
            ),
          );
          return;
        }
        if (
          Number(res.headers["content-length"]) >
          (options.maxBytes ?? MAX_BYTES)
        ) {
          res.destroy();
          reject(new Error("Video exceeds the 500 MB limit."));
          return;
        }
        let size = 0;
        const limit = new Transform({
          transform(chunk, _encoding, cb) {
            size += chunk.length;
            cb(
              size > (options.maxBytes ?? MAX_BYTES)
                ? new Error("Video exceeds the 500 MB limit.")
                : null,
              chunk,
            );
          },
        });
        pipeline(res, limit, fs.createWriteStream(dest), { signal }).then(
          () => resolve(),
          reject,
        );
      },
    );
    req.setTimeout(30000, () =>
      req.destroy(
        new Error("Video download timed out. Retry or upload a file."),
      ),
    );
    req.on("error", reject);
  });
}
export async function importVideo(
  url: string,
  dir: string,
  signal: AbortSignal,
) {
  const source = videoSource(url);
  await fs.promises.mkdir(dir, { recursive: true });
  const file = path.join(dir, "input.mp4");
  if (source.kind === "direct") await downloadPublic(source.url, file, signal);
  else if (source.kind === "youtube") {
    const id = new URL(source.url).searchParams.get("v")!;
    checkYouTubeInfo(await rapidYouTubeRequest("info", id, signal));
    const selected = selectYouTubeFormats(
      await rapidYouTubeRequest("download", id, signal),
    );
    const video = path.join(dir, "youtube-video.bin");
    const audio = path.join(dir, "youtube-audio.bin");
    const downloadSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(300000),
    ]);
    try {
      await downloadPublic(selected.video.url, video, downloadSignal, 0, {
        userAgent: selected.video.userAgent,
      });
      if (selected.audio) {
        const remaining = MAX_BYTES - (await fs.promises.stat(video)).size;
        await downloadPublic(selected.audio.url, audio, downloadSignal, 0, {
          maxBytes: remaining,
          userAgent: selected.audio.userAgent,
        });
        await command(
          "ffmpeg",
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-protocol_whitelist",
            "file,pipe",
            "-i",
            video,
            "-protocol_whitelist",
            "file,pipe",
            "-i",
            audio,
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-threads",
            "2",
            "-movflags",
            "+faststart",
            file,
          ],
          300000,
          signal,
        );
      } else await fs.promises.rename(video, file);
    } catch (error) {
      if (error instanceof Error && error.message.includes("500 MB"))
        throw error;
      throw new Error(
        "The RapidAPI video could not be downloaded or merged. Its link may have expired or been blocked. Retry to request fresh links, or upload the file.",
      );
    } finally {
      await Promise.all(
        [video, audio].map((p) => fs.promises.rm(p, { force: true })),
      );
    }
  } else if (source.kind === "tiktok") {
    try {
      await downloadTikTokVideo(source.url, dir, "input", MAX_BYTES);
    } catch {
      throw new Error(
        "TikTok download failed. Check provider access, retry, or upload the file.",
      );
    }
  } else {
    try {
      await command(
        process.env.CONTENT_CLIP_YTDLP || "./venv/bin/yt-dlp",
        [
          "--ignore-config",
          "--js-runtimes",
          "node",
          "--no-playlist",
          "--no-warnings",
          "--no-progress",
          "--socket-timeout",
          "30",
          "--retries",
          "2",
          "--max-filesize",
          String(MAX_BYTES),
          "--match-filter",
          `duration <= ${MAX_SECONDS} & !is_live`,
          "-f",
          "bv*[height<=1080]+ba/b[height<=1080]",
          "--merge-output-format",
          "mp4",
          "-o",
          file,
          "--",
          source.url,
        ],
        300000,
        signal,
      );
    } catch {
      throw new Error(
        "This platform blocked the download or the video is unavailable. Retry or upload the video file.",
      );
    }
  }
  if ((await fs.promises.stat(file)).size > MAX_BYTES)
    throw new Error("Video exceeds the 500 MB limit.");
  if (source.kind === "youtube" && !(await probe(file)).audio)
    throw new Error(
      "RapidAPI returned a video without sound. Retry or upload a video with audio.",
    );
  return file;
}
export async function probe(file: string) {
  const { stdout } = await command(
    "ffprobe",
    [
      "-protocol_whitelist",
      "file,pipe",
      "-v",
      "error",
      "-show_format",
      "-show_streams",
      "-of",
      "json",
      file,
    ],
    30000,
  );
  const data = JSON.parse(stdout);
  const duration = Number(data.format.duration);
  if (
    !/^(mov,mp4,m4a,3gp,3g2,mj2|matroska,webm|avi)$/.test(
      data.format.format_name,
    )
  )
    throw new Error("Use an MP4, MOV, WebM, or AVI video file.");
  const video = data.streams.find(
    (s: { codec_type: string }) => s.codec_type === "video",
  );
  if (video && video.width * video.height > 34000000)
    throw new Error(
      "This video resolution is too large. Upload a version at 4K or lower.",
    );
  if (
    !data.streams.some(
      (s: { codec_type: string }) => s.codec_type === "video",
    ) ||
    !Number.isFinite(duration) ||
    duration < 1 ||
    duration > MAX_SECONDS
  )
    throw new Error("Use a video between 1 second and 20 minutes long.");
  return {
    duration,
    audio: data.streams.some(
      (s: { codec_type: string }) => s.codec_type === "audio",
    ),
  };
}
export async function normalizeVideo(
  input: string,
  output: string,
  signal: AbortSignal,
) {
  const info = await probe(input);
  await command(
    "ffmpeg",
    [
      "-y",
      "-v",
      "error",
      "-protocol_whitelist",
      "file,pipe",
      "-i",
      input,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-vf",
      "scale=w='min(1920,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "22",
      "-threads",
      "2",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      output,
    ],
    900000,
    signal,
  );
  return info;
}
export function byteRange(header: string | null, size: number) {
  if (!header) return { start: 0, end: size - 1, partial: false };
  const m = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!m || (!m[1] && !m[2])) return null;
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1;
  return Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    start >= 0 &&
    start <= end &&
    start < size
    ? { start, end, partial: true }
    : null;
}
