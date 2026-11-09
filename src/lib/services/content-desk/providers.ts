import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { ContentSource } from "@prisma/client";
import { date, DeskError, plain, publicUrl } from "./rules";
import { providerJson, safeText } from "./network";

export type Candidate = {
  url: string;
  title: string;
  excerpt: string;
  publisher: string;
  platform: string;
  publishedAt: Date | null;
  coverage: string;
  views?: bigint | null;
  likes?: bigint | null;
};
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const arr = (v: unknown): unknown[] =>
  v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];
const str = (v: unknown): string =>
  typeof v === "string" ? v : String(obj(v)["#text"] ?? "");
const counter = (v: unknown) =>
  (typeof v === "string" && /^\d+$/.test(v)) ||
  (typeof v === "number" && Number.isFinite(v) && v >= 0)
    ? BigInt(Math.floor(Number(v)))
    : null;
export function parseFeed(
  xml: string,
  base: string,
  publisher: string,
): Candidate[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true)
    throw new DeskError(
      "INVALID_FEED",
      "This URL did not return a valid RSS or Atom feed. Edit it to use the publisher's feed URL.",
    );
  const data = new XMLParser({
    ignoreAttributes: false,
    processEntities: false,
    parseTagValue: false,
  }).parse(xml);
  const channel = obj(obj(data.rss).channel),
    feed = obj(data.feed);
  if (!data.rss && !data.feed)
    throw new DeskError(
      "INVALID_FEED",
      "This is a web page, not an RSS feed. Choose Web page tracking or provide an RSS URL.",
    );
  return arr(channel.item ?? feed.entry)
    .slice(0, 30)
    .flatMap((value) => {
      const item = obj(value);
      const link =
        typeof item.link === "string"
          ? item.link
          : str(
              obj(
                arr(item.link).find(
                  (l) => !obj(l)["@_rel"] || obj(l)["@_rel"] === "alternate",
                ),
              )["@_href"],
            );
      if (!link) return [];
      let url: string;
      try {
        url = publicUrl(new URL(link, base).toString());
      } catch {
        return [];
      }
      const title = plain(item.title, 500);
      if (!title) return [];
      const desc = str(
        item.description ??
          item.summary ??
          item.content ??
          item["content:encoded"],
      );
      return [
        {
          url,
          title,
          excerpt: plain(desc, 3500),
          publisher: plain(str(item.source) || publisher, 200),
          platform: "ARTICLE",
          publishedAt: date(item.pubDate ?? item.published ?? item.updated),
          coverage: "FEED_EXCERPT",
        },
      ];
    });
}
export async function webpage(url: string): Promise<Candidate> {
  const result = await safeText(url);
  const meta = (name: string) => {
    for (const tag of result.body.match(/<meta\b[^>]*>/gi) || []) {
      const attrs = Object.fromEntries(
        [...tag.matchAll(/([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g)].map((m) => [
          m[1].toLowerCase(),
          m[3],
        ]),
      );
      if (attrs.property === name || attrs.name === name)
        return attrs.content || "";
    }
    return "";
  };
  const title = plain(
    meta("og:title") ||
      result.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1],
    500,
  );
  if (!title)
    throw new DeskError(
      "NO_CONTENT",
      "Could not read a title from this page. Submit it manually with a title and notes instead.",
    );
  return {
    url: result.url,
    title,
    excerpt: plain(meta("og:description") || meta("description"), 3500),
    publishedAt: date(meta("article:published_time")),
    publisher: new URL(result.url).hostname,
    platform: "ARTICLE",
    coverage: "PAGE_METADATA",
  };
}
async function youtube(source: ContentSource): Promise<Candidate[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key)
    throw new DeskError(
      "MISSING_KEY",
      "YouTube tracking needs YOUTUBE_API_KEY on the server. Ask an admin to configure it, then retry.",
    );
  const yt = (path: string, params: Record<string, string>) =>
    providerJson(
      `https://www.googleapis.com/youtube/v3/${path}?${new URLSearchParams({ ...params, key })}`,
    );
  const url = new URL(source.url);
  let playlistId = url.searchParams.get("list");
  if (!playlistId) {
    const handle = url.pathname.match(/^\/@(.+)/)?.[1];
    const id = url.pathname.match(/^\/channel\/(.+)/)?.[1];
    const channels = await yt("channels", {
      part: "contentDetails",
      ...(handle ? { forHandle: handle } : { id: id || "" }),
    });
    playlistId = channels.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!playlistId)
      throw new DeskError(
        "CHANNEL_NOT_FOUND",
        "YouTube channel not found. Check its current channel URL or handle.",
      );
  }
  const videos = await yt("playlistItems", {
    part: "snippet",
    playlistId: playlistId!,
    maxResults: "20",
  });
  const ids = (videos.items || [])
    .map(
      (v: { snippet?: { resourceId?: { videoId?: string } } }) =>
        v.snippet?.resourceId?.videoId,
    )
    .filter(Boolean);
  const details = ids.length
    ? await yt("videos", { part: "statistics", id: ids.join(",") })
    : { items: [] };
  const stats = new Map<string, Obj>(
    (details.items || []).map((v: { id: string; statistics: Obj }) => [
      v.id,
      v.statistics,
    ]),
  );
  return (videos.items || []).flatMap(
    (v: {
      snippet: {
        resourceId: { videoId: string };
        title: string;
        description: string;
        channelTitle: string;
        publishedAt: string;
      };
    }) => {
      const s = v.snippet,
        id = s.resourceId?.videoId;
      if (!id || !stats.has(id)) return [];
      return [
        {
          url: `https://www.youtube.com/watch?v=${id}`,
          title: plain(s.title, 500),
          excerpt: plain(s.description, 3500),
          publisher: s.channelTitle,
          platform: "YOUTUBE",
          publishedAt: date(s.publishedAt),
          coverage: "VIDEO_DESCRIPTION",
          views: counter(stats.get(id)?.viewCount),
          likes: counter(stats.get(id)?.likeCount),
        },
      ];
    },
  );
}
export async function collect(source: ContentSource) {
  if (source.kind === "RSS") {
    const result = await safeText(source.url);
    return parseFeed(result.body, result.url, source.name);
  }
  if (source.kind === "WEBPAGE") return [await webpage(source.url)];
  if (source.kind === "YOUTUBE") return youtube(source);
  throw new DeskError("UNSUPPORTED", "This source type is not supported.");
}
export async function apify(path: string, init?: RequestInit) {
  const token = process.env.APIFY_TOKEN;
  if (!token)
    throw new DeskError(
      "MISSING_KEY",
      "Social tracking needs APIFY_TOKEN on the server. Ask an admin to configure it, then retry.",
    );
  return providerJson(`https://api.apify.com/v2/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}
export async function startSocial(source: ContentSource) {
  const isTikTok = source.kind === "TIKTOK";
  const actor = isTikTok
    ? "clockworks~tiktok-scraper"
    : "apify~instagram-scraper";
  const username = new URL(source.url).pathname
    .replace(/^\/@?/, "")
    .replace(/\/$/, "");
  const input = isTikTok
    ? {
        profiles: [username],
        resultsPerPage: 20,
        shouldDownloadVideos: false,
        shouldDownloadCovers: false,
      }
    : { directUrls: [source.url], resultsType: "posts", resultsLimit: 20 };
  const result = await apify(
    `actors/${actor}/runs?timeout=180&maxItems=20&maxTotalChargeUsd=0.50`,
    { method: "POST", body: JSON.stringify(input) },
  );
  if (!result.data?.id)
    throw new DeskError(
      "INVALID_RESPONSE",
      "The social provider did not return a run ID. Check provider activity before retrying.",
    );
  return result.data.id as string;
}
export function socialItems(raw: unknown, source: ContentSource): Candidate[] {
  if (!Array.isArray(raw))
    throw new DeskError(
      "INVALID_RESPONSE",
      "The social provider returned an unreadable result. Retry later.",
    );
  if (raw.some((v) => obj(v).error || obj(v).errorCode))
    throw new DeskError(
      "PROFILE_UNAVAILABLE",
      "The provider could not read this profile. Check that it is public and its username is correct; then retry.",
    );
  return raw.slice(0, 30).flatMap((value) => {
    const v = obj(value),
      author = obj(v.authorMeta);
    let url: string;
    try {
      url = publicUrl(String(v.webVideoUrl || v.url || ""));
    } catch {
      return [];
    }
    const caption = plain(v.text || v.caption || "", 3500);
    return [
      {
        url,
        title: caption.slice(0, 180) || `${source.name} posted an update`,
        excerpt: caption,
        publisher: String(author.name || v.ownerUsername || source.name),
        platform: source.kind,
        publishedAt: date(v.createTimeISO || v.createTime || v.timestamp),
        coverage: "SOCIAL_CAPTION",
        views: counter(v.playCount ?? v.videoViewCount ?? v.videoPlayCount),
        likes: counter(v.diggCount ?? v.likesCount),
      },
    ];
  });
}
