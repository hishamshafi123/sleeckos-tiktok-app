import React from "react";
import { spring, useVideoConfig } from "remotion";
import type { StyleParams } from "../../../../lib/style-lab/schema";
import { ImportedStage, impTextStyle, textLines, useScaledFrame } from "./shared";

const FALLBACK_ITEMS = ["First idea", "Second idea", "Third idea"];

/**
 * Ported from reactvideoeditor/remotion-templates `animated-list.tsx` (MIT).
 * Rows (one per text line) slide/fade/scale in with a stagger; each row
 * gets an accent dot.
 */
export const AnimatedList: React.FC<StyleParams> = (props) => {
  const frame = useScaledFrame(props);
  const { fps } = useVideoConfig();
  const items = textLines(props.text, FALLBACK_ITEMS);
  const accent = props.accentColor ?? "#E11D48";
  const fontSize = Number(props.fontSize ?? 34);

  return (
    <ImportedStage params={props}>
      <div style={{ display: "flex", flexDirection: "column", gap: fontSize * 0.7, width: "100%", alignItems: "stretch" }}>
        {items.map((item, i) => {
          const delay = i * 6;
          const slideX = spring({ frame: frame - delay, fps, from: -100, to: 0, config: { damping: 12, mass: 0.5 } });
          const opacity = spring({ frame: frame - delay, fps, from: 0, to: 1, config: { damping: 12, mass: 0.5 } });
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                opacity,
                transform: `translateX(${slideX}px)`,
                backgroundColor: "#18181B",
                border: "1px solid #27272A",
                borderRadius: 10,
                padding: "14px 20px",
                textAlign: "left",
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: accent, flexShrink: 0 }} />
              <span style={impTextStyle(props)}>{item}</span>
            </div>
          );
        })}
      </div>
    </ImportedStage>
  );
};
