import { MAX_BYTES, MAX_SECONDS } from "../../content-clips/schema";
import { setTimeout as delay } from "node:timers/promises";

const HOST = "cloud-api-hub-youtube-downloader.p.rapidapi.com";
type Row = Record<string, unknown>;
type Format = {
  url: string;
  height: number;
  video: boolean;
  audio: boolean;
  h264: boolean;
  aac: boolean;
  bitrate: number;
  bytes: number;
  userAgent?: string;
};
const object = (value: unknown): Row =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : {};
const positive = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function checkYouTubeInfo(value: unknown) {
  const info = object(value);
  if (
    info.is_live ||
    info.isLive ||
    info.is_upcoming ||
    info.live_status === "is_upcoming"
  )
    throw new Error(
      "Live and upcoming YouTube videos cannot be imported. Choose a finished video.",
    );
  if (info.is_private || info._has_drm)
    throw new Error(
      "This YouTube video is private or protected. Choose another video.",
    );
  let duration = positive(info.duration);
  if (!duration && typeof info.duration === "string") {
    const iso = info.duration.match(
      /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/,
    );
    if (iso)
      duration =
        positive(iso[1]) * 3600 + positive(iso[2]) * 60 + positive(iso[3]);
  }
  if (!duration)
    throw new Error(
      "RapidAPI could not verify this video's duration. Retry or upload the file.",
    );
  if (duration > MAX_SECONDS)
    throw new Error("Video exceeds the 20 minute limit.");
}

export function selectYouTubeFormats(value: unknown): {
  video: Format;
  audio?: Format;
} {
  if (!Array.isArray(value))
    throw new Error(
      "RapidAPI returned an unexpected format list. Retry or upload the file.",
    );
  const formats: Format[] = value.flatMap((item) => {
    const f = object(item);
    if (
      f.isLive ||
      f.isHLS ||
      f.isDashMPD ||
      f.has_drm ||
      (f.protocol && f.protocol !== "https")
    )
      return [];
    if (typeof f.url !== "string") return [];
    let url: URL;
    try {
      url = new URL(f.url);
    } catch {
      return [];
    }
    // Only accept the Google Video links this endpoint is documented to return.
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".googlevideo.com") ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    )
      return [];
    const codec = String(f.vcodec || f.videoCodec || "");
    const audioCodec = String(f.acodec || f.audioCodec || "");
    const height = positive(f.height);
    const video =
      f.hasVideo === true || (!!codec && codec !== "none" && height > 0);
    const audio =
      f.hasAudio === true || (!!audioCodec && audioCodec !== "none");
    const bytes = positive(f.contentLength || f.filesize || f.filesize_approx);
    if (bytes > MAX_BYTES || positive(f.approxDurationMs) > MAX_SECONDS * 1000)
      return [];
    const ua = object(f.http_headers)["User-Agent"];
    return [
      {
        url: url.toString(),
        height,
        video,
        audio,
        h264: /^(avc1|h264)/i.test(codec),
        aac: /^(mp4a|aac)/i.test(audioCodec),
        bitrate: positive(f.audioBitrate || f.abr || f.bitrate || f.tbr),
        bytes,
        userAgent:
          typeof ua === "string" && ua.length <= 512 && !/[\r\n]/.test(ua)
            ? ua
            : undefined,
      },
    ];
  });
  const videos = formats
    .filter((f) => f.video && f.height > 0 && f.height <= 1080)
    .sort(
      (a, b) =>
        b.height - a.height ||
        Number(b.audio) - Number(a.audio) ||
        Number(b.h264) - Number(a.h264),
    );
  const audios = formats
    .filter((f) => f.audio && !f.video)
    .sort((a, b) => Number(b.aac) - Number(a.aac) || b.bitrate - a.bitrate);
  for (const video of videos) {
    if (video.audio) return { video };
    const audio = audios.find((a) => a.bytes + video.bytes <= MAX_BYTES);
    if (audio) return { video, audio };
  }
  throw new Error(
    "RapidAPI returned no video with sound within the 1080p / 500 MB limits. Try another video or upload the file.",
  );
}

export async function rapidYouTubeRequest(
  endpoint: "info" | "download",
  id: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<unknown> {
  const key = process.env.RAPIDAPI_YOUTUBE_KEY;
  if (!key)
    throw new Error(
      "YouTube downloads need the RapidAPI key. Ask an admin to configure RAPIDAPI_YOUTUBE_KEY.",
    );
  if (!/^[\w-]{11}$/.test(id))
    throw new Error("Use a valid YouTube video link.");
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(90000)]);
  try {
    const request = () =>
      fetcher(`https://${HOST}/${endpoint}?id=${encodeURIComponent(id)}`, {
        headers: {
          "X-RapidAPI-Key": key,
          "X-RapidAPI-Host": HOST,
          "User-Agent": "Sleeckos/1.0",
          Accept: "application/json",
        },
        signal: boundedSignal,
        redirect: "error",
        cache: "no-store",
      });
    let response = await request();
    // RapidAPI may limit bursts even while the monthly request quota remains.
    // Retry once for a short rate window; never loop on exhausted quota.
    const retryAfter = response.headers.get("retry-after");
    const retrySeconds = retryAfter === null ? 1.2 : Number(retryAfter);
    if (
      response.status === 429 &&
      response.headers.get("x-ratelimit-requests-remaining") !== "0" &&
      Number.isFinite(retrySeconds) &&
      retrySeconds >= 0 &&
      retrySeconds <= 5
    ) {
      await response.body?.cancel();
      await delay(Math.max(1200, retrySeconds * 1000), undefined, {
        signal: boundedSignal,
      });
      response = await request();
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403)
        throw new Error(
          "RapidAPI denied access. Ask an admin to check the YouTube Downloader subscription and API key.",
        );
      if (response.status === 429)
        throw new Error(
          "RapidAPI's rate or quota limit has been reached. Retry shortly; if it persists, ask an admin to check the plan and quota reset.",
        );
      if (response.status === 404)
        throw new Error(
          "RapidAPI could not find this YouTube video. Check the link or upload the file.",
        );
      throw new Error(
        `RapidAPI YouTube Downloader is unavailable (HTTP ${response.status}). Retry shortly or upload the video.`,
      );
    }
    const reader = response.body?.getReader();
    if (!reader)
      throw new Error(
        "RapidAPI returned an empty response. Retry the download.",
      );
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 2 * 1024 * 1024) {
        await reader.cancel();
        throw new Error(
          "RapidAPI returned too much metadata. Try another video.",
        );
      }
      chunks.push(next.value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new Error(
        "RapidAPI returned an unreadable response. Retry shortly or upload the file.",
      );
    }
  } catch (error) {
    if (boundedSignal.aborted)
      throw new Error(
        signal.aborted
          ? "YouTube download was interrupted. Retry the import."
          : "RapidAPI timed out. Retry the import or upload the video.",
      );
    // Never surface upstream response bodies, signed URLs or authentication headers.
    if (error instanceof Error && error.message.startsWith("RapidAPI"))
      throw error;
    throw new Error(
      "Could not reach RapidAPI YouTube Downloader. Retry shortly or upload the file.",
    );
  }
}
