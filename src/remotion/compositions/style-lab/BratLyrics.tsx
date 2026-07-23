import React from "react";
import {
  AbsoluteFill,
  CalculateMetadataFunction,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  SAMPLE_LYRIC_LINES,
  STYLE_LAB_FPS,
  resolveCanvas,
  resolveDurationMs,
  type LyricLine,
  type StyleParams,
} from "../../../lib/style-lab/schema";
import { wordTimings } from "./shared";

export type BratLyricsProps = StyleParams & { lines?: LyricLine[] };

/**
 * brat-lyrics — the REAL brat mechanic, ported from the reference generator
 * (scratch/brat_repo/main.py), not the line-by-line preset:
 *
 *  - Words of the CURRENT lyric line appear one at a time and ACCUMULATE on
 *    screen (time distributed evenly across the line's [startMs, endMs]).
 *    The next line replaces the previous one.
 *  - Auto-fit font: as words accumulate, a binary search shrinks the size so
 *    the accumulated block always fits (width minus padding, max 60% of the
 *    frame height, capped by the maxFontSize param).
 *  - Justified layout: wrapped lines >85% full are justified (words spread
 *    across the full text width); the last (incomplete) line stays
 *    left-aligned. Text block starts at 20% from the top, 50px side padding
 *    (scaled to the 720-wide design canvas).
 *  - Lo-Fi pixelation: the whole text block is mosaiced (the repo downsamples
 *    by lofiFactor then re-upscales nearest-neighbor; here an SVG
 *    feFlood/feTile/feMorphology mosaic — the same approach as shared.tsx's
 *    pixelate, extended to 20 levels).
 *
 * Measurement runs in-browser (Remotion renders in Chromium) via an
 * offscreen canvas measureText with the bundled font; a char-width
 * estimator covers environments without a canvas (Node, SSR).
 */

// ─── Text measurement (canvas measureText + fallback estimator) ──────────────

interface Measurer {
  wordWidth: (word: string, size: number) => number;
  spaceWidth: (size: number) => number;
}

let measureCanvas: HTMLCanvasElement | null = null;

function makeMeasurer(fontFamily: string, fontWeight: number): Measurer {
  let ctx: CanvasRenderingContext2D | null = null;
  if (typeof document !== "undefined") {
    try {
      measureCanvas = measureCanvas ?? document.createElement("canvas");
      ctx = measureCanvas.getContext("2d");
    } catch {
      ctx = null;
    }
  }
  if (ctx) {
    const fontFor = (size: number) => `${fontWeight} ${size}px '${fontFamily}', sans-serif`;
    return {
      wordWidth: (word, size) => {
        ctx!.font = fontFor(size);
        const w = ctx!.measureText(word).width;
        // A zero width means the font isn't ready — fall back per call.
        return w > 0 ? w : estimateWordWidth(word, size);
      },
      spaceWidth: (size) => {
        ctx!.font = fontFor(size);
        const w = ctx!.measureText(" ").width;
        return w > 0 ? w : size * 0.28;
      },
    };
  }
  return {
    wordWidth: (word, size) => estimateWordWidth(word, size),
    spaceWidth: (size) => size * 0.28,
  };
}

/** Rough sans-serif estimate (~Inter 500): avg glyph ≈ 0.52em, spaces 0.28em. */
function estimateWordWidth(word: string, size: number): number {
  let units = 0;
  for (const ch of word) {
    if ("iljtf.,'!|".includes(ch)) units += 0.28;
    else if ("mwMW".includes(ch)) units += 0.82;
    else units += 0.52;
  }
  return units * size;
}

// ─── Wrap / fit / justify layout (the reference algorithm) ───────────────────

interface LaidOutWord {
  text: string;
  x: number;
  y: number;
}

const LINE_HEIGHT_FACTOR = 1.12; // repo: cap-height line + small fixed spacing
const JUSTIFY_FULLNESS = 0.85; // repo: lines >85% full justify, else left-align

/** Greedy word wrap at a candidate font size (same as get_wrapped_lines). */
function wrapWords(words: string[], size: number, maxWidth: number, m: Measurer): string[][] {
  const lines: string[][] = [];
  let current: string[] = [];
  let currentWidth = 0;
  const space = m.spaceWidth(size);
  for (const word of words) {
    const w = m.wordWidth(word, size);
    if (current.length === 0) {
      current = [word];
      currentWidth = w;
    } else if (currentWidth + space + w <= maxWidth) {
      current.push(word);
      currentWidth += space + w;
    } else {
      lines.push(current);
      current = [word];
      currentWidth = w;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

/** Block height for n wrapped lines at a font size. */
function blockHeight(lineCount: number, size: number): number {
  return lineCount > 0 ? lineCount * size * LINE_HEIGHT_FACTOR : 0;
}

/**
 * Binary search the largest font size whose wrapped block fits the target
 * box (get_optimal_font_size). Capped by maxFontSize (scaled to canvas).
 */
function optimalFontSize(
  words: string[],
  targetWidth: number,
  targetHeight: number,
  maxSize: number,
  m: Measurer,
): number {
  const fits = (size: number) => {
    const lines = wrapWords(words, size, targetWidth, m);
    return blockHeight(lines.length, size) <= targetHeight;
  };
  let low = 12;
  let high = Math.max(low, Math.round(maxSize));
  let best = low;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (fits(mid)) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

/**
 * Absolute word positions with justified alignment
 * (calculate_word_positions): full lines justify across the text width, the
 * last incomplete line (and single-word lines) left-align.
 */
function layoutWords(
  words: string[],
  size: number,
  canvasW: number,
  canvasH: number,
  padX: number,
  m: Measurer,
): LaidOutWord[] {
  const targetWidth = canvasW - padX * 2;
  const lines = wrapWords(words, size, targetWidth, m);
  const space = m.spaceWidth(size);
  const out: LaidOutWord[] = [];
  let y = Math.round(canvasH * 0.2); // fixed top alignment: 20% from top

  lines.forEach((lineWords, i) => {
    const widths = lineWords.map((w) => m.wordWidth(w, size));
    const sumWords = widths.reduce((a, b) => a + b, 0);
    const naturalWidth = sumWords + (lineWords.length - 1) * space;
    const isLast = i === lines.length - 1;
    const fullEnough = naturalWidth / targetWidth > JUSTIFY_FULLNESS;
    const leftAlign = (isLast && !fullEnough) || lineWords.length === 1;

    if (leftAlign) {
      let x = padX;
      lineWords.forEach((w, j) => {
        out.push({ text: w, x, y });
        x += widths[j] + space;
      });
    } else {
      const gap =
        lineWords.length > 1 ? (targetWidth - sumWords) / (lineWords.length - 1) : 0;
      let x = (canvasW - targetWidth) / 2; // centered text block
      lineWords.forEach((w, j) => {
        out.push({ text: w, x: Math.round(x), y });
        x += widths[j] + gap;
      });
    }
    y += size * LINE_HEIGHT_FACTOR;
  });
  return out;
}

// ─── Lo-Fi pixelation (SVG mosaic, same approach as shared.tsx — 20 levels) ──

const BratPixelateDefs: React.FC = () => (
  <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
    <defs>
      {Array.from({ length: 20 }, (_, i) => {
        const level = i + 1;
        const cell = 2 * level;
        return (
          <filter id={`brat-pixelate-${level}`} key={level} x="0%" y="0%" width="100%" height="100%">
            <feFlood x="2" y="2" height="1" width="1" />
            <feComposite width={cell} height={cell} />
            <feTile result="a" />
            <feComposite in="SourceGraphic" in2="a" operator="in" />
            <feMorphology operator="dilate" radius={level} />
          </filter>
        );
      })}
    </defs>
  </svg>
);

// ─── Component ───────────────────────────────────────────────────────────────

export const BratLyrics: React.FC<BratLyricsProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const rawLines = props.lines && props.lines.length > 0 ? props.lines : SAMPLE_LYRIC_LINES;
  const offset = Number(props.timingOffsetMs ?? 0);
  const lines = rawLines.map((l) => ({
    ...l,
    startMs: l.startMs + offset,
    endMs: l.endMs + offset,
  }));

  const t = (frame / fps) * 1000;
  const active = lines.find((l) => t >= l.startMs && t < l.endMs) ?? null;

  const textTransform = props.textTransform ?? "lowercase";
  const fontFamily = props.fontFamily ?? "Inter";
  const fontWeight = Number(props.fontWeight ?? 500);
  const scale = width / 720; // design basis: 720×1280, 50px padding, maxFont 120
  const padX = Math.round(50 * scale);
  const maxFont = Number(props.maxFontSize ?? 120) * scale;
  const targetHeight = height * 0.6; // 20% top + 20% bottom → 60% usable

  // Words accumulated so far on the active line (text case applied before
  // measuring so the layout matches the rendered glyphs exactly).
  const visibleWords = React.useMemo(() => {
    if (!active) return [];
    const words = wordTimings(active.text, active.startMs, active.endMs);
    const count = Math.max(1, words.filter((w) => t >= w.startMs).length);
    const shown = words.slice(0, count).map((w) => w.word);
    if (textTransform === "lowercase") return shown.map((w) => w.toLowerCase());
    if (textTransform === "uppercase") return shown.map((w) => w.toUpperCase());
    return shown;
  }, [active, t, textTransform]);

  const layout = React.useMemo(() => {
    if (visibleWords.length === 0) return { size: 0, words: [] as LaidOutWord[] };
    const m = makeMeasurer(fontFamily, fontWeight);
    const size = optimalFontSize(visibleWords, width - padX * 2, targetHeight, maxFont, m);
    return { size, words: layoutWords(visibleWords, size, width, height, padX, m) };
  }, [visibleWords, fontFamily, fontWeight, width, height, padX, targetHeight, maxFont]);

  const bg = props.bgColor ?? "#8ACE00";
  const lofi = Math.round(Number(props.lofiFactor ?? 5));
  const filter = lofi > 1 ? `url(#brat-pixelate-${Math.min(20, lofi)})` : undefined;

  return (
    <AbsoluteFill style={{ backgroundColor: bg === "transparent" ? "transparent" : bg }}>
      <BratPixelateDefs />
      <div style={{ position: "absolute", inset: 0, filter }}>
        {layout.words.map((w, i) => (
          <span
            key={i}
            style={{
              position: "absolute",
              left: w.x,
              top: w.y,
              fontFamily: `'${fontFamily}', sans-serif`,
              fontWeight,
              fontSize: layout.size,
              lineHeight: 1,
              color: props.textColor ?? "#000000",
              whiteSpace: "pre",
            }}
          >
            {w.text}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
};

export const bratLyricsCalculateMetadata: CalculateMetadataFunction<BratLyricsProps> = ({
  props,
}) => {
  const { width, height } = resolveCanvas(props);
  const lines = props.lines && props.lines.length > 0 ? props.lines : SAMPLE_LYRIC_LINES;
  const durationMs = resolveDurationMs("lyric", { lines });
  return {
    width,
    height,
    durationInFrames: Math.max(1, Math.round((durationMs / 1000) * STYLE_LAB_FPS)),
  };
};
