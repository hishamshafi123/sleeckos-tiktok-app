import React from "react";
import { interpolate, useVideoConfig } from "remotion";
import type { StyleParams } from "../../../../lib/style-lab/schema";
import { ImportedStage, useScaledFrame } from "./shared";

/**
 * Ported from reactvideoeditor/remotion-templates `text-highlight.tsx` (MIT).
 * Words get swept with an accent highlight pill, one after another —
 * a karaoke-style read-along.
 */
export const TextHighlight: React.FC<StyleParams> = (props) => {
  const frame = useScaledFrame(props);
  const { durationInFrames } = useVideoConfig();
  const words = String(props.text ?? "Build amazing videos with code").split(/\s+/).filter(Boolean);
  const accent = props.accentColor ?? "#E11D48";
  const fontSize = Number(props.fontSize ?? 56);

  const framesPerWord = Math.max(6, Math.floor((durationInFrames * 0.7) / Math.max(1, words.length)));

  return (
    <ImportedStage params={props}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: `${fontSize * 0.28}px ${fontSize * 0.22}px` }}>
        {words.map((word, i) => {
          const wordStart = i * framesPerWord;
          const progress = interpolate(frame, [wordStart, wordStart + framesPerWord * 0.6], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          const active = progress > 0 && progress < 1;
          const done = progress >= 1;
          return (
            <span
              key={i}
              style={{
                position: "relative",
                display: "inline-block",
                padding: "0 0.18em",
                fontFamily: `'${props.fontFamily ?? "Inter"}', sans-serif`,
                fontWeight: Number(props.fontWeight ?? 800),
                fontSize,
                color: done ? (props.textColor ?? "#FAFAFA") : active ? "#FFFFFF" : "#71717A",
              }}
            >
              {progress > 0 && (
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    inset: "-0.05em -0.08em",
                    backgroundColor: accent,
                    borderRadius: 6,
                    transform: `scaleX(${progress})`,
                    transformOrigin: "left",
                    zIndex: -1,
                  }}
                />
              )}
              {word}
            </span>
          );
        })}
      </div>
    </ImportedStage>
  );
};
