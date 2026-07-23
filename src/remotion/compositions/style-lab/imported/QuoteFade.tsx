import React from "react";
import { interpolate } from "remotion";
import type { StyleParams } from "../../../../lib/style-lab/schema";
import { ImportedStage, impTextStyle, useScaledFrame } from "./shared";

/**
 * Ported from reactvideoeditor/remotion-templates `quote-card.tsx` (MIT).
 * Serif quote mark fades in, quote follows, attribution slides in last.
 */
export const QuoteFade: React.FC<StyleParams> = (props) => {
  const frame = useScaledFrame(props);
  const quote = String(props.text ?? "");
  const attribution = String(props.subtitle ?? "");
  const accent = props.accentColor ?? "#E11D48";

  const markOpacity = interpolate(frame, [0, 15], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const textOpacity = interpolate(frame, [10, 30], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const attrOpacity = interpolate(frame, [30, 45], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const attrX = interpolate(frame, [30, 45], [40, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <ImportedStage params={props}>
      <span
        style={{
          fontFamily: "Georgia, serif",
          fontSize: Number(props.fontSize ?? 34) * 2.4,
          fontWeight: 700,
          lineHeight: 0.8,
          color: accent,
          opacity: markOpacity,
          marginBottom: 16,
        }}
      >
        {"“"}
      </span>
      <p style={impTextStyle(props, { lineHeight: 1.5, opacity: textOpacity })}>{quote}</p>
      {attribution !== "" && (
        <p
          style={impTextStyle(props, {
            fontSize: Number(props.fontSize ?? 34) * 0.55,
            fontWeight: 500,
            color: "#A1A1AA",
            marginTop: 28,
            opacity: attrOpacity,
            transform: `translateX(${attrX}px)`,
          })}
        >
          — {attribution}
        </p>
      )}
    </ImportedStage>
  );
};
