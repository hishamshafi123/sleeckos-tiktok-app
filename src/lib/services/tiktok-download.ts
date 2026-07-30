import fs from "fs";
import path from "path";

/**
 * TikTok video download via Apify (clockworks/tiktok-scraper).
 *
 * yt-dlp from our datacenter IP is hard-blocked by TikTok ("No video formats
 * found"), so downloads run through Apify's infra instead: the actor scrapes
 * the video AND stores the mp4 in its key-value store, which we then fetch.
 */

const ACTOR_ID = process.env.APIFY_ACTOR_ID || "clockworks~tiktok-scraper";
const API_BASE = "https://api.apify.com/v2";
const RUN_TIMEOUT_MS = parseInt(process.env.TIKTOK_DOWNLOAD_TIMEOUT_MS || "300000", 10);
const POLL_INTERVAL_MS = 5000;

export type TikTokDownloadResult = {
  localPath: string;
  durationSec: number | null;
  sizeBytes: number;
  meta: {
    author: string;
    title: string;
    resolution: string | null;
    videoId: string | null;
  };
};

export class TikTokDownloadError extends Error {
  kind: "private" | "unavailable" | "rate_limited" | "transient";
  constructor(kind: TikTokDownloadError["kind"], message: string) {
    super(message);
    this.kind = kind;
  }
}

function token(): string {
  const t = process.env.APIFY_TOKEN;
  if (!t) throw new TikTokDownloadError("transient", "APIFY_TOKEN not set");
  return t;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (res.status === 429) {
    throw new TikTokDownloadError("rate_limited", "Apify rate limit (429)");
  }
  if (res.status === 401 || res.status === 403) {
    throw new TikTokDownloadError("transient", `Apify auth error (${res.status}) — check APIFY_TOKEN`);
  }
  return res;
}

export async function downloadTikTokVideo(
  url: string,
  destDir: string,
  destBaseName: string
): Promise<TikTokDownloadResult> {
  const tk = token();

  // 1) Start the actor (scrape + download to its key-value store).
  const startRes = await apiFetch(`${API_BASE}/acts/${ACTOR_ID}/runs?token=${tk}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      postURLs: [url],
      shouldDownloadVideos: true,
      resultsPerPage: 1,
    }),
  });
  if (!startRes.ok) {
    const body = await startRes.text();
    throw new TikTokDownloadError("transient", `Apify run start failed (${startRes.status}): ${body.slice(0, 300)}`);
  }
  const run = (await startRes.json()).data as { id: string; defaultKeyValueStoreId?: string };

  // 2) Poll until terminal.
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  let status = "";
  let storeId = run.defaultKeyValueStoreId || "";
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const pollRes = await apiFetch(`${API_BASE}/actor-runs/${run.id}?token=${tk}`);
    if (!pollRes.ok) continue;
    const data = (await pollRes.json()).data as { status: string; defaultKeyValueStoreId?: string };
    status = data.status;
    if (data.defaultKeyValueStoreId) storeId = data.defaultKeyValueStoreId;
    if (["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"].includes(status)) break;
  }
  if (status !== "SUCCEEDED") {
    throw new TikTokDownloadError("transient", `Apify run ended as ${status || "timeout"}`);
  }

  // 3) Dataset items → metadata + scrape-level errors.
  const itemsRes = await apiFetch(`${API_BASE}/actor-runs/${run.id}/dataset/items?token=${tk}`);
  const items = itemsRes.ok ? await itemsRes.json() : [];
  const item = Array.isArray(items) ? items[0] : null;
  if (item?.errorCode) {
    const code = String(item.errorCode);
    if (code.includes("PRIVATE") || code.includes("LOGIN")) {
      throw new TikTokDownloadError("private", `TikTok video is private/login-gated (${code})`);
    }
    throw new TikTokDownloadError("unavailable", `TikTok video unavailable (${code})`);
  }

  // 4) Find the mp4 in the key-value store and download it.
  if (!storeId) throw new TikTokDownloadError("transient", "Apify run has no key-value store");
  const keysRes = await apiFetch(`${API_BASE}/key-value-stores/${storeId}/keys?token=${tk}`);
  const keysData = await keysRes.json();
  const keys: { key: string }[] = keysData?.data?.items ?? [];
  const videoKey = keys.map((k) => k.key).find((k) => /^video-.*\.mp4$/i.test(k));
  if (!videoKey) {
    throw new TikTokDownloadError(
      "unavailable",
      "No downloadable mp4 (slideshow/photo post or removed video)"
    );
  }

  await fs.promises.mkdir(destDir, { recursive: true });
  const localPath = path.join(destDir, `${destBaseName}.mp4`);
  const fileRes = await apiFetch(
    `${API_BASE}/key-value-stores/${storeId}/records/${encodeURIComponent(videoKey)}?token=${tk}`
  );
  if (!fileRes.ok) {
    throw new TikTokDownloadError("transient", `KV record download failed (${fileRes.status})`);
  }
  const buf = Buffer.from(await fileRes.arrayBuffer());
  await fs.promises.writeFile(localPath, buf);
  const stat = await fs.promises.stat(localPath);
  if (stat.size < 50 * 1024) {
    try { fs.unlinkSync(localPath); } catch {}
    throw new TikTokDownloadError("transient", `Downloaded file suspiciously small (${stat.size} bytes)`);
  }

  const meta = item ?? {};
  const resolution =
    meta?.videoMeta?.height && meta?.videoMeta?.width
      ? `${meta.videoMeta.width}x${meta.videoMeta.height}`
      : null;

  return {
    localPath,
    durationSec: typeof meta?.videoMeta?.duration === "number" && meta.videoMeta.duration > 0 ? meta.videoMeta.duration : null,
    sizeBytes: stat.size,
    meta: {
      author: meta?.authorMeta?.name || "",
      title: typeof meta?.text === "string" ? meta.text.slice(0, 200) : "",
      resolution,
      videoId: meta?.id != null ? String(meta.id) : null,
    },
  };
}
