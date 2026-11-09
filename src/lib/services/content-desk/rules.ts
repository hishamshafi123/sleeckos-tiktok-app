export const STATES = [
  {
    code: "SC",
    name: "South Carolina",
    cities: "Columbia,Charleston,Greenville,Myrtle Beach,Spartanburg",
    channel: "WLTX",
    publisher: "scdailygazette.com",
  },
  {
    code: "NV",
    name: "Nevada",
    cities: "Las Vegas,Reno,Carson City,Henderson,Clark County",
    channel: "8NewsNow",
    publisher: "nevadacurrent.com",
  },
  {
    code: "NH",
    name: "New Hampshire",
    cities: "Manchester,Nashua,Concord,Portsmouth,Granite State",
    channel: "WMUR",
    publisher: "newhampshirebulletin.com",
  },
  {
    code: "NM",
    name: "New Mexico",
    cities: "Albuquerque,Santa Fe,Las Cruces,Taos,Roswell",
    channel: "KRQE",
    publisher: "sourcenm.com",
  },
  {
    code: "MI",
    name: "Michigan",
    cities: "Detroit,Lansing,Grand Rapids,Flint,Ann Arbor,Upper Peninsula",
    channel: "ClickOnDetroit",
    publisher: "michiganadvance.com",
  },
  {
    code: "VA",
    name: "Virginia",
    cities: "Richmond,Norfolk,Virginia Beach,Roanoke,Arlington,Hampton Roads",
    channel: "12OnYourSide",
    publisher: "virginiamercury.com",
  },
  {
    code: "GA",
    name: "Georgia",
    cities: "Atlanta,Savannah,Augusta,Macon,Athens,Marietta",
    channel: "11Alive",
    publisher: "georgiarecorder.com",
  },
  {
    code: "AZ",
    name: "Arizona",
    cities: "Phoenix,Tucson,Flagstaff,Yuma,Scottsdale,Mesa",
    channel: "12NewsAZ",
    publisher: "azmirror.com",
  },
  {
    code: "OH",
    name: "Ohio",
    cities: "Columbus,Cleveland,Cincinnati,Toledo,Dayton,Akron",
    channel: "WBNS10TV",
    publisher: "ohiocapitaljournal.com",
  },
  {
    code: "PA",
    name: "Pennsylvania",
    cities: "Philadelphia,Pittsburgh,Harrisburg,Erie,Scranton,Allentown",
    channel: "6abcPhiladelphia",
    publisher: "penncapital-star.com",
  },
] as const;
export const SOURCE_KINDS = [
  "RSS",
  "YOUTUBE",
  "TIKTOK",
  "INSTAGRAM",
  "WEBPAGE",
] as const;
export const STATUSES = [
  "NEW",
  "SELECTED",
  "APPROVED",
  "POSTED",
  "NEEDS_REVIEW",
  "REJECTED",
  "OUTDATED",
] as const;
export const CATEGORIES = ["AUTO", "LOCAL", "POLITICS", "CULTURE"] as const;
export class DeskError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function text(value: unknown, max: number, label = "Value"): string {
  if (typeof value !== "string" || value.trim().length > max)
    throw new DeskError(
      "INVALID",
      `${label} must be text, up to ${max} characters.`,
    );
  return value.trim();
}
export function integer(value: unknown, min: number, max: number) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    throw new DeskError(
      "INVALID",
      `Enter a whole number between ${min} and ${max}.`,
    );
  return value;
}
export function publicUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DeskError("INVALID_URL", "Enter a complete https:// URL.");
  }
  if (
    url.protocol !== "https:" ||
    (url.port && url.port !== "443") ||
    url.username ||
    url.password ||
    !url.hostname.includes(".") ||
    url.hostname.endsWith(".local") ||
    url.hostname.endsWith(".internal") ||
    url.hostname.includes(":")
  ) {
    throw new DeskError(
      "INVALID_URL",
      "Use a public HTTPS URL without a password or custom port.",
    );
  }
  url.hash = "";
  for (const key of [...url.searchParams.keys()])
    if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  return url.toString();
}
export function sourceUrl(kind: string, value: string) {
  let candidate = value.trim();
  if (
    ["TIKTOK", "INSTAGRAM"].includes(kind) &&
    /^@?[\w.]{1,80}$/.test(candidate)
  )
    candidate =
      kind === "TIKTOK"
        ? `https://www.tiktok.com/@${candidate.replace(/^@/, "")}`
        : `https://www.instagram.com/${candidate.replace(/^@/, "")}/`;
  const parsed = new URL(publicUrl(candidate));
  const host = parsed.hostname.replace(/^www\./, "");
  if (
    kind === "TIKTOK" &&
    (host !== "tiktok.com" || !/^\/@[\w.]+\/?$/.test(parsed.pathname))
  )
    throw new DeskError(
      "INVALID_URL",
      "Enter a TikTok profile URL or @username, not a video link.",
    );
  if (
    kind === "INSTAGRAM" &&
    (host !== "instagram.com" ||
      !/^\/[\w.]+\/?$/.test(parsed.pathname) ||
      /^\/(p|reel|reels|explore|stories)\/?$/.test(parsed.pathname))
  )
    throw new DeskError(
      "INVALID_URL",
      "Enter an Instagram profile URL or @username, not a post link.",
    );
  if (
    kind === "YOUTUBE" &&
    (host !== "youtube.com" ||
      !/^\/(@[\w.-]+|channel\/UC[\w-]+|playlist)\/?$/.test(parsed.pathname))
  )
    throw new DeskError(
      "INVALID_URL",
      "Enter a YouTube channel or playlist URL.",
    );
  if (kind === "YOUTUBE") parsed.pathname = parsed.pathname.replace(/\/$/, "");
  if (["TIKTOK", "INSTAGRAM"].includes(kind)) {
    parsed.search = "";
    parsed.hostname = `www.${host}`;
    parsed.pathname = parsed.pathname.replace(/\/$/, "").toLowerCase();
  }
  return parsed.toString();
}
export function plain(value: unknown, max = 4000): string {
  return String(value ?? "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(?:amp|lt|gt|quot|apos|nbsp);/g,
      (v) =>
        ({
          "&amp;": "&",
          "&lt;": "<",
          "&gt;": ">",
          "&quot;": '"',
          "&apos;": "'",
          "&nbsp;": " ",
        })[v]!,
    )
    .replace(/&#(\d+);/g, (_, n) =>
      Number(n) < 65536 ? String.fromCharCode(Number(n)) : " ",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
export function date(value: unknown): Date | null {
  if (!value) return null;
  const d = new Date(
    typeof value === "number"
      ? value < 1e12
        ? value * 1000
        : value
      : String(value),
  );
  return Number.isNaN(d.getTime()) || d > new Date(Date.now() + 86400000)
    ? null
    : d;
}
const STOP = new Set(
  "a an the and or of for on in to is are as with from at by this that has have after new news says said video watch live update updates latest".split(
    " ",
  ),
);
export function tokens(title: string) {
  return new Set(
    plain(title)
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOP.has(t)),
  );
}
export function similar(a: string, b: string) {
  const x = tokens(a),
    y = tokens(b),
    common = [...x].filter((t) => y.has(t)).length;
  return (
    x.size >= 4 &&
    y.size >= 4 &&
    common >= 4 &&
    common / (x.size + y.size - common) >= 0.62
  );
}
export function category(title: string, hint = "AUTO") {
  if (hint !== "AUTO") return hint;
  if (
    /\b(election|senat|governor|legislat|democrat|republican|ballot|congress|vot(?:e|er|ing)|politic|bill signed)/i.test(
      title,
    )
  )
    return "POLITICS";
  if (
    /\b(festival|music|concert|restaurant|food|art|museum|culture|film|sport|football|basketball|celebrat|parade)/i.test(
      title,
    )
  )
    return "CULTURE";
  return "LOCAL";
}
export function relevant(
  title: string,
  excerpt: string,
  keywords: string,
  excluded: string,
) {
  const haystack = `${title} ${excerpt}`.toLowerCase();
  if (
    excluded
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .some((s) => haystack.includes(s))
  )
    return false;
  return keywords
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .some((s) =>
      new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(
        haystack,
      ),
    );
}
export function errorFeedback(error: unknown): {
  code: string;
  message: string;
} {
  if (error instanceof DeskError)
    return { code: error.code, message: error.message };
  return {
    code: "UNEXPECTED",
    message:
      "Collection could not finish. Retry the source; if this repeats, ask an admin to check the server logs.",
  };
}

export function accountStateName(a: {
  stateName: string | null;
  guardianPhone?: { name: string } | null;
  account?: {
    driveFolderName?: string | null;
    tiktokDisplayName?: string;
    tiktokUsername?: string;
  };
}) {
  return (
    a.stateName ||
    a.guardianPhone?.name ||
    a.account?.driveFolderName ||
    a.account?.tiktokDisplayName ||
    a.account?.tiktokUsername ||
    ""
  )
    .replace(/^pol\s+acc\s+/i, "")
    .trim();
}
