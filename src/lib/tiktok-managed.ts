/**
 * TikTok posting helpers for managed accounts.
 * Uses the Content Posting API FILE_UPLOAD method — no domain verification needed.
 *
 * Flow:
 *   1. initPost()    → get upload_url + publish_id from TikTok
 *   2. uploadChunks() → PUT video buffer to TikTok's upload_url
 *   3. Cron polls checkPostStatus() until PUBLISH_COMPLETE or error
 */

const TIKTOK_API = "https://open.tiktokapis.com/v2";

// ── 1. Query creator info (privacy levels etc.) ───────────────────────────────
export async function queryCreatorInfo(accessToken: string) {
  const res = await fetch(`${TIKTOK_API}/post/publish/creator_info/query/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
  });
  return res.json();
}

// ── 2. Init direct post via FILE_UPLOAD ──────────────────────────────────────
export async function initManagedPost(
  accessToken: string,
  {
    caption,
    videoSize,
    chunkSize,
    mode = "DIRECT",
  }: {
    caption: string;
    videoSize: number;
    chunkSize: number;
    mode?: "DIRECT" | "DRAFT";
  }
) {
  const endpoint =
    mode === "DRAFT"
      ? `${TIKTOK_API}/post/publish/inbox/video/init/`
      : `${TIKTOK_API}/post/publish/video/init/`;

  const body: Record<string, unknown> = {
    post_info: {
      title: caption.slice(0, 2200),
      privacy_level: "PUBLIC_TO_EVERYONE",
      disable_comment: false,
      disable_duet: false,
      disable_stitch: false,
    },
    source_info: {
      source: "FILE_UPLOAD",
      video_size: videoSize,
      chunk_size: chunkSize,
      total_chunk_count: Math.ceil(videoSize / chunkSize),
    },
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ── 3. Upload video chunks ────────────────────────────────────────────────────
export async function uploadVideoChunks(
  uploadUrl: string,
  videoBuffer: Buffer
) {
  const CHUNK = 10 * 1024 * 1024; // 10 MB chunks
  const total = videoBuffer.length;
  const numChunks = Math.ceil(total / CHUNK);

  for (let i = 0; i < numChunks; i++) {
    const start = i * CHUNK;
    const end = Math.min(start + CHUNK, total) - 1;
    const chunk = videoBuffer.slice(start, end + 1);

    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Content-Length": chunk.length.toString(),
      },
      body: chunk,
    });

    if (!res.ok && res.status !== 206) {
      throw new Error(
        `Chunk ${i + 1}/${numChunks} upload failed: ${res.status}`
      );
    }
  }
}

// ── 4. Poll publish status ───────────────────────────────────────────────────
export async function checkPublishStatus(
  accessToken: string,
  publishId: string
) {
  const res = await fetch(`${TIKTOK_API}/post/publish/status/fetch/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({ publish_id: publishId }),
  });
  return res.json();
}

// ── 5. Refresh an access token ───────────────────────────────────────────────
export async function refreshTikTokToken(refreshToken: string) {
  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY!,
      client_secret: process.env.TIKTOK_CLIENT_SECRET!,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  return res.json();
}

// ── 6. Full post pipeline: init → upload → return publish_id ─────────────────
export async function postVideoToTikTok(
  accessToken: string,
  videoBuffer: Buffer,
  caption: string,
  mode: "DIRECT" | "DRAFT" = "DIRECT"
): Promise<{ publishId: string }> {
  const CHUNK = 10 * 1024 * 1024; // 10 MB

  // Init
  const initData = await initManagedPost(accessToken, {
    caption,
    videoSize: videoBuffer.length,
    chunkSize: CHUNK,
    mode,
  });

  if (initData.error?.code !== "ok" && !initData.data?.publish_id) {
    throw new Error(
      `TikTok init failed: ${JSON.stringify(initData.error || initData)}`
    );
  }

  const publishId: string = initData.data.publish_id;
  const uploadUrl: string = initData.data.upload_url;

  // Upload chunks
  await uploadVideoChunks(uploadUrl, videoBuffer);

  return { publishId };
}
