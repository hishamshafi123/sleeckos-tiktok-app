import React from "react";
import { spring, useVideoConfig } from "remotion";
import type { StyleParams } from "../../../../lib/style-lab/schema";
import { ImportedStage, useScaledFrame } from "./shared";

/**
 * Ported from reactvideoeditor/remotion-templates `bubble-pop-text.tsx` (MIT).
 * Each character pops in inside a flat circle, staggered springs.
 */
export const BubblePop: React.FC<StyleParams> = (props) => {
  const frame = useScaledFrame(props);
  const { fps } = useVideoConfig();
  const text = String(props.text ?? "HELLO");
  const accent = props.accentColor ?? "#E11D48";
  const fontSize = Number(props.fontSize ?? 52);
  const bubble = Math.round(fontSize * 1.9);

  return (
    <ImportedStage params={props}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 12 }}>
        {text.split("").map((char, i) => {
          const scale = spring({
            frame: frame - i * 5,
            fps,
            from: 0,
            to: 1,
            config: { damping: 8, mass: 0.3, stiffness: 100 },
          });
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                transform: `scale(${scale})`,
                fontFamily: `'${props.fontFamily ?? "Anton"}', sans-serif`,
                fontWeight: Number(props.fontWeight ?? 400),
                fontSize,
                color: props.textColor ?? "#FAFAFA",
                border: `3px solid ${accent}`,
                borderRadius: "50%",
                width: bubble,
                height: bubble,
                lineHeight: `${bubble - 6}px`,
                textAlign: "center",
                backgroundColor: "#18181B",
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
