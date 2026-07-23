import React from "react";
import { spring, useVideoConfig } from "remotion";
import type { StyleParams } from "../../../../lib/style-lab/schema";
import { ImportedStage, useScaledFrame } from "./shared";

/**
 * Ported from reactvideoeditor/remotion-templates `popping-text.tsx` (MIT).
 * Big per-character pop with alternating text/accent colors.
 */
export const PoppingText: React.FC<StyleParams> = (props) => {
  const frame = useScaledFrame(props);
  const { fps } = useVideoConfig();
  const text = String(props.text ?? "BINGO!");
  const colors = [props.textColor ?? "#FAFAFA", props.accentColor ?? "#E11D48", "#A1A1AA"];

  return (
    <ImportedStage params={props}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center" }}>
        {text.split("").map((char, i) => {
          const delay = i * 7;
          const scale = spring({ frame: frame - delay, fps, from: 0, to: 1, config: { mass: 0.4, damping: 8, stiffness: 100 } });
          const opacity = spring({ frame: frame - delay, fps, from: 0, to: 1, config: { mass: 0.3, damping: 8, stiffness: 100 } });
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                opacity,
                color: colors[i % colors.length],
                fontFamily: `'${props.fontFamily ?? "Anton"}', sans-serif`,
                fontWeight: Number(props.fontWeight ?? 400),
                fontSize: Number(props.fontSize ?? 110),
                margin: "0 0.04em",
                transform: `scale(${scale})`,
                letterSpacing: "0.05em",
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
