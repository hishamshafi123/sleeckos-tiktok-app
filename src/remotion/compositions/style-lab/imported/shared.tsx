import React from "react";
import { AbsoluteFill, CalculateMetadataFunction, useCurrentFrame } from "remotion";
import { STYLE_LAB_FPS, type StyleParams } from "../../../../lib/style-lab/schema";

/**
 * Shared scaffolding for the imported template compositions
 * (ported from reactvideoeditor/remotion-templates, MIT — see
 * src/lib/style-lab/imported.ts for the registry).
 *
 * Every imported comp:
 *  - renders on a fixed 720×1280 (9:16) canvas,
 *  - honors bgColor ("transparent" default), positionYPercent and
 *    animationSpeed params,
 *  - uses only bundled FONT_MANIFEST families (font loading happens at
 *    the Remotion root, like the base style-lab comps).
 */

export const IMPORTED_CANVAS = { width: 720, height: 1280 } as const;

/** Fixed-canvas metadata; duration comes from the template registry. */
export function importedCalculateMetadata(
  durationMs: number,
): CalculateMetadataFunction<StyleParams> {
  return () => ({
    width: IMPORTED_CANVAS.width,
    height: IMPORTED_CANVAS.height,
    durationInFrames: Math.max(1, Math.round((durationMs / 1000) * STYLE_LAB_FPS)),
  });
}

/** Current frame scaled by the animationSpeed param (time remap). */
export function useScaledFrame(params: StyleParams): number {
  const frame = useCurrentFrame();
  const speed = Number(params.animationSpeed ?? 1);
  return frame * Math.max(0.05, Number.isFinite(speed) ? speed : 1);
}

/** Base text style from the lean imported schema params. */
export function impTextStyle(
  p: StyleParams,
  overrides: React.CSSProperties = {},
): React.CSSProperties {
  return {
    fontFamily: `'${p.fontFamily ?? "Inter"}', sans-serif`,
    fontWeight: Number(p.fontWeight ?? 700),
    fontSize: Number(p.fontSize ?? 56),
    color: p.textColor ?? "#FAFAFA",
    lineHeight: 1.15,
    margin: 0,
    wordBreak: "break-word",
    ...overrides,
  };
}

/**
 * Stage wrapper: paints the bgColor (transparent allowed) and centers
 * children at positionYPercent with side margins. `fullBleed` comps
 * (credits roll, spotlight) manage their own layout.
 */
export const ImportedStage: React.FC<{
  params: StyleParams;
  children: React.ReactNode;
  fullBleed?: boolean;
}> = ({ params, children, fullBleed }) => {
  const bg = params.bgColor ?? "transparent";
  if (fullBleed) {
    return (
      <AbsoluteFill style={{ backgroundColor: bg === "transparent" ? "transparent" : bg }}>
        {children}
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ backgroundColor: bg === "transparent" ? "transparent" : bg }}>
      <div
        style={{
          position: "absolute",
          top: `${Number(params.positionYPercent ?? 50)}%`,
          left: 48,
          right: 48,
          transform: "translateY(-50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
};

/** Split a multiline text param into trimmed non-empty lines. */
export function textLines(text: string | undefined, fallback: string[]): string[] {
  const lines = String(text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : fallback;
}
