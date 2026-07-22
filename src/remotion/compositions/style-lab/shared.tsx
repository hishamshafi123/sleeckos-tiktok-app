import React from "react";
import {
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { StyleParams } from "../../../lib/style-lab/schema";

/**
 * Shared visual helpers for the Style Lab compositions
 * (lyric-caption / quote-card). Every style param in the schemas is
 * interpreted here so both compositions stay thin.
 */

// ─── Text style ──────────────────────────────────────────────────────────────

export function buildTextStyle(p: StyleParams): React.CSSProperties {
  const intensity = Number(p.shadowIntensity ?? 0.4);
  const shadow =
    p.shadow && intensity > 0
      ? `0 ${Math.round(2 + intensity * 6)}px ${Math.round(6 + intensity * 26)}px rgba(0, 0, 0, ${Math.min(0.85, 0.2 + intensity * 0.6)})`
      : undefined;
  const outlineWidth = Number(p.outlineWidth ?? 0);

  return {
    fontFamily: `'${p.fontFamily ?? "Inter"}', sans-serif`,
    fontWeight: Number(p.fontWeight ?? 700),
    fontStyle: p.italic ? "italic" : "normal",
    fontSize: `${Number(p.fontSize ?? 44)}px`,
    letterSpacing: `${Number(p.letterSpacing ?? 0)}px`,
    lineHeight: Number(p.lineHeight ?? 1.25),
    textTransform: (p.textTransform ?? "none") as React.CSSProperties["textTransform"],
    color: p.textColor ?? "#FFFFFF",
    WebkitTextStroke:
      outlineWidth > 0 ? `${outlineWidth}px ${p.outlineColor ?? "#000000"}` : undefined,
    paintOrder: "stroke fill",
    textShadow: shadow,
    wordBreak: "break-word",
  };
}

// ─── Entry animation ─────────────────────────────────────────────────────────

export interface EntryState {
  opacity: number;
  transform?: string;
}

/**
 * Entry progress (0→1) for a block that appears at `startFrame`, honoring
 * entryType / entryDurationMs / easing params.
 */
export function useEntry(p: StyleParams, startFrame = 0): EntryState {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const type = p.entryType ?? "fade";
  const durMs = Number(p.entryDurationMs ?? 300);
  if (type === "none" || durMs <= 0) return { opacity: 1 };

  const durFrames = Math.max(1, (durMs / 1000) * fps);
  const local = frame - startFrame;

  let prog: number;
  if ((p.easing ?? "ease-out") === "spring") {
    prog = spring({
      frame: Math.max(0, local),
      fps,
      config: { damping: 16, stiffness: 180, mass: 0.7 },
      durationInFrames: Math.ceil(durFrames),
    });
  } else {
    const easingName = p.easing ?? "ease-out";
    const easingFn =
      easingName === "linear"
        ? Easing.linear
        : easingName === "ease-in-out"
          ? Easing.inOut(Easing.cubic)
          : Easing.out(Easing.cubic);
    prog = interpolate(local, [0, durFrames], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: easingFn,
    });
  }

  switch (type) {
    case "slide-up":
      return { opacity: prog, transform: `translateY(${Math.round((1 - prog) * 48)}px)` };
    case "pop":
      return {
        opacity: Math.min(1, prog * 1.6),
        transform: `scale(${(0.72 + 0.28 * prog).toFixed(4)})`,
      };
    case "fade":
    default:
      return { opacity: prog };
  }
}

/** Exit-fade multiplier (1 → 0 over 250ms before endFrame) when exitType=fade. */
export function exitOpacity(p: StyleParams, frame: number, fps: number, endFrame: number): number {
  if ((p.exitType ?? "fade") !== "fade") return 1;
  const fadeFrames = Math.max(1, Math.round(fps * 0.25));
  return interpolate(frame, [endFrame - fadeFrames, endFrame], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

// ─── Full-canvas effects (pixelate / blur / vignette / grain / noise) ────────

const NOISE_SVG = (seed: number) =>
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch' seed='${seed}'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23n)'/%3E%3C/svg%3E")`;

/** Discrete SVG mosaic filters, levels 1..10 (Chromium-safe pixelation). */
export const PixelateFilterDefs: React.FC = () => (
  <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
    <defs>
      {Array.from({ length: 10 }, (_, i) => {
        const level = i + 1;
        const cell = 2 * level;
        return (
          <filter id={`sl-pixelate-${level}`} key={level} x="0%" y="0%" width="100%" height="100%">
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

/**
 * CSS `filter` value for the content layer combining blur + pixelate.
 * Returns undefined when both are zero (no filter).
 */
export function contentFilter(p: StyleParams): string | undefined {
  const parts: string[] = [];
  const blur = Number(p.blur ?? 0);
  if (blur > 0) parts.push(`blur(${blur}px)`);
  const pixelate = Math.round(Number(p.pixelate ?? 0));
  if (pixelate > 0) parts.push(`url(#sl-pixelate-${Math.min(10, pixelate)})`);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

/** Post overlays: vignette, animated grain, static noise. Render above content. */
export const EffectOverlays: React.FC<{ params: StyleParams }> = ({ params }) => {
  const frame = useCurrentFrame();
  const vignette = Number(params.vignette ?? 0);
  const grain = Number(params.grain ?? 0);
  const noise = Number(params.noise ?? 0);
  if (vignette <= 0 && grain <= 0 && noise <= 0) return null;

  // Animated grain: deterministic per-frame jitter of an oversized noise layer.
  const jx = ((frame * 137) % 97) - 48;
  const jy = ((frame * 211) % 89) - 44;

  return (
    <>
      {vignette > 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 52%, rgba(0,0,0,${(vignette * 0.9).toFixed(3)}) 100%)`,
          }}
        />
      )}
      {noise > 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            backgroundImage: NOISE_SVG(7),
            opacity: noise * 0.28,
            mixBlendMode: "overlay",
          }}
        />
      )}
      {grain > 0 && (
        <div
          style={{
            position: "absolute",
            top: -60,
            left: -60,
            right: -60,
            bottom: -60,
            pointerEvents: "none",
            backgroundImage: NOISE_SVG(3),
            opacity: grain * 0.4,
            mixBlendMode: "overlay",
            transform: `translate(${jx}px, ${jy}px)`,
          }}
        />
      )}
    </>
  );
};

// ─── Timing helpers ──────────────────────────────────────────────────────────

export interface WordTiming {
  word: string;
  startMs: number;
  endMs: number;
}

/** Evenly distribute a line's words across its [startMs, endMs] window. */
export function wordTimings(text: string, startMs: number, endMs: number): WordTiming[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const span = Math.max(1, endMs - startMs);
  const step = span / words.length;
  return words.map((word, i) => ({
    word,
    startMs: startMs + i * step,
    endMs: startMs + (i + 1) * step,
  }));
}
