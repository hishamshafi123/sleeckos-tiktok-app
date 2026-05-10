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

  return {
    ok: true,
    postId: data.id || data.postId || data._id,
    raw: data,
  };
}
