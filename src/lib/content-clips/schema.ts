export const MAX_SECONDS = 1200;
export const MAX_BYTES = 500 * 1024 * 1024;
export const FPS = 30;
export const OVERLAYS = [
  { id: "bulletin", name: "State bulletin", accent: "#2563eb" },
  { id: "local", name: "Local report", accent: "#0f766e" },
  { id: "headline", name: "Headline", accent: "#b91c1c" },
  { id: "clean", name: "Clean", accent: "#27272a" },
] as const;
export const OUTROS = [
  { id: "none", name: "No outro" },
  { id: "follow", name: "Follow for local updates" },
  { id: "state", name: "Your state, informed" },
] as const;
export type Word = { word: string; start: number; end: number };
export type Suggestion = {
  start: number;
  end: number;
  title: string;
  reason: string;
  context: string;
  hooks: string[];
};
export type Draft = {
  start: number;
  end: number;
  hook: string;
  overlay: string;
  outro: string;
  brand: string;
  logo?: string;
  credit: string;
  captions: boolean;
  crop: "cover" | "contain";
  position: number;
  muted: boolean;
  suggestedStart: number | null;
  suggestedEnd: number | null;
};
export function defaultDraft(brand: string, credit = ""): Draft {
  return {
    start: 0,
    end: 30,
    hook: "",
    overlay: "bulletin",
    outro: "follow",
    brand: brand.slice(0, 60),
    logo: "",
    credit: credit.slice(0, 100),
    captions: false,
    crop: "cover",
    position: 50,
    muted: false,
    suggestedStart: null,
    suggestedEnd: null,
  };
}
const num = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const str = (v: unknown, max: number) =>
  typeof v === "string" && v.length <= max;
export function validateDraft(value: unknown, duration: number): Draft {
  const d = value as Draft;
  if (
    !d ||
    !num(d.start) ||
    !num(d.end) ||
    d.start < 0 ||
    d.end > duration + 0.001 ||
    d.end - d.start < 1 ||
    d.end - d.start > 180
  )
    throw new Error(
      "Choose a clip between 1 and 180 seconds, within the source video.",
    );
  if (
    !str(d.hook, 140) ||
    !str(d.brand, 60) ||
    !str(d.credit, 100) ||
    !OVERLAYS.some((p) => p.id === d.overlay) ||
    !OUTROS.some((p) => p.id === d.outro) ||
    !["cover", "contain"].includes(d.crop) ||
    !num(d.position) ||
    d.position < 0 ||
    d.position > 100 ||
    typeof d.captions !== "boolean" ||
    typeof d.muted !== "boolean"
  )
    throw new Error("Check the hook, branding, and video settings.");
  if (
    d.logo &&
    (typeof d.logo !== "string" ||
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]{1,170000}$/.test(
        d.logo,
      ))
  )
    throw new Error("Use a PNG, JPEG, or WebP logo smaller than 120 KB.");
  return {
    start: d.start,
    end: d.end,
    hook: d.hook.trim(),
    overlay: d.overlay,
    outro: d.outro,
    brand: d.brand.trim(),
    logo: d.logo || "",
    credit: d.credit.trim(),
    captions: d.captions,
    crop: d.crop,
    position: d.position,
    muted: d.muted,
    suggestedStart: num(d.suggestedStart) ? d.suggestedStart : null,
    suggestedEnd: num(d.suggestedEnd) ? d.suggestedEnd : null,
  };
}
export function validateWords(value: unknown, duration: number): Word[] {
  if (!Array.isArray(value) || value.length > 30000)
    throw new Error("The transcript is too large or invalid.");
  let previous = 0;
  return value.map((w) => {
    if (
      !w ||
      !str(w.word, 120) ||
      !num(w.start) ||
      !num(w.end) ||
      w.start < previous ||
      w.end <= w.start ||
      w.end > duration + 0.1
    )
      throw new Error(
        "Transcript timestamps must be ordered and within the video.",
      );
    previous = w.start;
    return {
      word: w.word.trim(),
      start: w.start,
      end: Math.min(w.end, duration),
    };
  });
}
export function validateSuggestions(
  value: unknown,
  words: Word[],
  duration: number,
): Suggestion[] {
  if (!Array.isArray(value) || !value.length || value.length > 5)
    throw new Error(
      "AI did not return usable clip suggestions. Retry or trim manually.",
    );
  return value.map((s) => {
    if (
      !s ||
      !num(s.start) ||
      !num(s.end) ||
      s.start < 0 ||
      s.end > duration ||
      s.end - s.start < 1 ||
      s.end - s.start > 180 ||
      !str(s.title, 120) ||
      !str(s.reason, 500) ||
      !str(s.context, 500) ||
      !Array.isArray(s.hooks) ||
      !s.hooks.length ||
      s.hooks.length > 5 ||
      !s.hooks.every((h: unknown) => str(h, 140)) ||
      !words.some((w) => w.start < s.end && w.end > s.start)
    )
      throw new Error(
        "AI returned invalid timestamps or hooks. Retry or trim manually.",
      );
    return {
      start: s.start,
      end: s.end,
      title: s.title,
      reason: s.reason,
      context: s.context,
      hooks: s.hooks,
    };
  });
}
export function framesFor(draft: Draft) {
  return (
    Math.max(1, Math.round((draft.end - draft.start) * FPS)) +
    (draft.outro === "none" ? 0 : 3 * FPS)
  );
}
export function timecode(seconds: number) {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
}
export function captionChunks(words: Word[]) {
  const chunks: { text: string; start: number; end: number }[] = [];
  for (let i = 0; i < words.length; i += 6) {
    const group = words.slice(i, i + 6);
    chunks.push({
      text: group.map((w) => w.word).join(" "),
      start: group[0].start,
      end: group.at(-1)!.end,
    });
  }
  return chunks;
}
