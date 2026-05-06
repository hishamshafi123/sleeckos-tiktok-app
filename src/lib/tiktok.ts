const API_BASE = "https://open.tiktokapis.com/v2";

export async function getUserInfo(accessToken: string, fields: string) {
  const res = await fetch(
    `${API_BASE}/user/info/?fields=${encodeURIComponent(fields)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return res.json();
}

export async function getCreatorInfo(accessToken: string) {
  const res = await fetch(`${API_BASE}/post/publish/creator_info/query/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
  });
  return res.json();
}

export async function initDirectPost(accessToken: string, payload: any) {
  const res = await fetch(`${API_BASE}/post/publish/video/init/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(payload),
  });
  return res.json();
}

// video.upload scope — posts to creator's TikTok inbox as a draft
export async function initDraftPost(accessToken: string, payload: any) {
  const res = await fetch(`${API_BASE}/post/publish/inbox/video/init/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function checkPostStatus(accessToken: string, publishId: string) {
  const res = await fetch(`${API_BASE}/post/publish/status/fetch/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({ publish_id: publishId }),
  });
  return res.json();
}

export async function revokeToken(accessToken: string) {
  const res = await fetch(`${API_BASE}/oauth/revoke/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY!,
      access_token: accessToken,
    }),
  });
  return res.json();
}
