import React from "react";
import { interpolate } from "remotion";
import type { StyleParams } from "../../../../lib/style-lab/schema";
import { ImportedStage, useScaledFrame } from "./shared";

/**
 * Ported from reactvideoeditor/remotion-templates `pulsing-text.tsx` (MIT).
 * Per-character looping pulse (scale + opacity), staggered phase.
 */
export const PulsingText: React.FC<StyleParams> = (props) => {
  const frame = useScaledFrame(props);
  const text = String(props.text ?? "PULSE");

  return (
    <ImportedStage params={props}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center" }}>
        {text.split("").map((char, i) => {
          const delay = i * 6;
          const phase = (((frame - delay) % 30) + 30) % 30 / 30;
          const pulse = interpolate(phase, [0, 0.5, 1], [1, 1.2, 1]);
          const opacity = interpolate(phase, [0, 0.5, 1], [0.55, 1, 0.55]);
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                transform: `scale(${pulse})`,
                opacity,
                fontFamily: `'${props.fontFamily ?? "Archivo"}', sans-serif`,
                fontWeight: Number(props.fontWeight ?? 800),
                fontSize: Number(props.fontSize ?? 84),
                color: props.textColor ?? "#FAFAFA",
                whiteSpace: "pre",
              }}
            >
              {char === " " ? " " : char}
            </span>
          );
        })}
      </div>
    </ImportedStage>
  );
};
