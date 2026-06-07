/**
 * PostPeer.dev posting client.
 *
 * Flow:
 *   1. Make the Google Drive file temporarily public
 *   2. Build a direct-download URL for it
 *   3. Call PostPeer's POST /v1/posts/ with the video URL
 *   4. Revoke public access (cleanup done by caller after post)
 */

const POSTPEER_API = "https://api.postpeer.dev/v1";

function getAccessKey(): string {
  const key = process.env.POSTPEER_ACCESS_KEY;
  if (!key) throw new Error("POSTPEER_ACCESS_KEY env var not set");
  return key;
}

/** Build a direct-download URL for a Google Drive file */
export function driveDirectUrl(fileId: string): string {
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

export interface PostPeerOptions {
  draft?: boolean;
  privacyLevel?: string;
  disableComment?: boolean;
  disableDuet?: boolean;
  disableStitch?: boolean;
  publishNow?: boolean;
}

export interface PostPeerResult {
  ok: boolean;
  postId?: string;
  platformPostUrl?: string;
  platformPostId?: string;
  raw: Record<string, unknown>;
}

/**
 * Post a video via PostPeer.
 * @param postpeerAccountId  The PostPeer account ID for the TikTok account
 * @param caption            Video caption / title
 * @param videoUrl           Publicly accessible video URL
 * @param options            TikTok-specific posting options
 */
export async function postViaPostPeer(
  postpeerAccountId: string,
  caption: string,
  videoUrl: string,
  options: PostPeerOptions = {}
): Promise<PostPeerResult> {
  const {
    draft = false,
    privacyLevel = "PUBLIC_TO_EVERYONE",
    disableComment = false,
    disableDuet = false,
    disableStitch = false,
    publishNow = true,
  } = options;

  const body = {
    content: caption,
    platforms: [
      {
        platform: "tiktok",
        accountId: postpeerAccountId,
        platformSpecificData: {
          draft,
          privacyLevel,
          disableComment,
          disableDuet,
          disableStitch,
        },
      },
    ],
    mediaItems: [
      {
        type: "video",
        url: videoUrl,
      },
    ],
    publishNow,
  };

  console.log(
    `[PostPeer] Posting to account ${postpeerAccountId}, videoUrl=${videoUrl}`
  );

  const res = await fetch(`${POSTPEER_API}/posts/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-access-key": getAccessKey(),
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  console.log(`[PostPeer] Response (${res.status}):`, JSON.stringify(data));

  if (!res.ok) {
    throw new Error(
      `PostPeer API error (${res.status}): ${JSON.stringify(data)}`
    );
  }

  // PostPeer response: { success: true, post: { postId, platforms: [...] } }
  // OR the initial POST might return a flat structure
  const postData = data.post || data;
  const platforms = postData.platforms || [];
  const tiktokPlatform = Array.isArray(platforms)
    ? platforms.find((p: Record<string, unknown>) => p.platform === "tiktok")
    : null;

  // platformPostId format: "v_pub_url~v2-1.7647150213232183318"
  // The actual TikTok video ID is the number after the last dot
  const rawPlatformPostId: string = tiktokPlatform?.platformPostId || "";
  let extractedVideoId: string | undefined;

  if (rawPlatformPostId.includes(".")) {
    extractedVideoId = rawPlatformPostId.split(".").pop();
  } else if (/^\d+$/.test(rawPlatformPostId)) {
    extractedVideoId = rawPlatformPostId;
  }

  return {
    ok: true,
    postId: postData.postId || data.id || data.postId || data._id,
    platformPostUrl: tiktokPlatform?.platformPostUrl || undefined,
    platformPostId: extractedVideoId || undefined,
    raw: data,
  };
}
