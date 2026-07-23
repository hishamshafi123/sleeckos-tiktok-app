import React from "react";
import { interpolate, spring, useVideoConfig } from "remotion";
import type { StyleParams } from "../../../../lib/style-lab/schema";
import { ImportedStage, impTextStyle, useScaledFrame } from "./shared";

/**
 * Ported from reactvideoeditor/remotion-templates `chapter-title.tsx` (MIT).
 * Small label, big springing number, growing divider, fading subtitle.
 */
export const ChapterTitle: React.FC<StyleParams> = (props) => {
  const frame = useScaledFrame(props);
  const { fps } = useVideoConfig();
  const label = String(props.label ?? "CHAPTER");
  const number = String(props.text ?? "01");
  const subtitle = String(props.subtitle ?? "");
  const accent = props.accentColor ?? "#E11D48";

  const numberScale = spring({ frame, fps, config: { damping: 12, stiffness: 80 } });
  const subtitleOpacity = interpolate(frame, [20, 40], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const subtitleY = interpolate(frame, [20, 40], [20, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const lineWidth = interpolate(frame, [10, 40], [0, 120], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const labelOpacity = interpolate(frame, [5, 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <ImportedStage params={props}>
      <p
        style={impTextStyle(props, {
          fontSize: Math.max(14, Number(props.fontSize ?? 120) * 0.16),
          fontWeight: 500,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: "#A1A1AA",
          opacity: labelOpacity,
          marginBottom: 8,
        })}
      >
        {label}
      </p>
      <h1
        style={impTextStyle(props, {
          fontWeight: 800,
          lineHeight: 1,
          transform: `scale(${numberScale})`,
        })}
      >
        {number}
      </h1>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 24, marginBottom: 16 }}>
        <div style={{ height: 1, width: lineWidth, backgroundColor: accent }} />
        <div style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: accent, opacity: labelOpacity }} />
        <div style={{ height: 1, width: lineWidth, backgroundColor: accent }} />
      </div>
      {subtitle !== "" && (
        <p
          style={impTextStyle(props, {
            fontSize: Number(props.fontSize ?? 120) * 0.22,
            fontWeight: 300,
            letterSpacing: "0.1em",
            color: "#D4D4D8",
            opacity: subtitleOpacity,
            transform: `translateY(${subtitleY}px)`,
          })}
        >
          {subtitle}
        </p>
      )}
    </ImportedStage>
  );
};
