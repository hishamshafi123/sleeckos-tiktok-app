import React from "react";
import { spring, useVideoConfig } from "remotion";
import type { StyleParams } from "../../../../lib/style-lab/schema";
import { ImportedStage, impTextStyle, useScaledFrame } from "./shared";

/**
 * Ported from reactvideoeditor/remotion-templates `animated-text.tsx` (MIT).
 * Per-character spring entrance (rise + rotate-in), staggered.
 */
export const KineticChars: React.FC<StyleParams> = (props) => {
  const frame = useScaledFrame(props);
  const { fps } = useVideoConfig();
  const text = String(props.text ?? "midnight in the city");

  return (
    <ImportedStage params={props}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center" }}>
        {text.split("").map((char, i) => {
          const delay = i * 3;
          const opacity = spring({ frame: frame - delay, fps, from: 0, to: 1, config: { mass: 0.5, damping: 10 } });
          const y = spring({ frame: frame - delay, fps, from: -50, to: 0, config: { mass: 0.5, damping: 10 } });
          const rotate = spring({ frame: frame - delay, fps, from: -180, to: 0, config: { mass: 0.5, damping: 12 } });
          return (
            <span
              key={i}
              style={{
                ...impTextStyle(props),
                display: "inline-block",
                opacity,
                transform: `translateY(${y}px) rotate(${rotate}deg)`,
                whiteSpace: "pre",
              }}
            >
              {char === " " ? " " : char}
            </span>
          );
        })}
      </div>
    </ImportedStage>
  );
};
