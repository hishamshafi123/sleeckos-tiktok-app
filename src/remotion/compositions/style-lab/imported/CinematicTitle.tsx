import React from "react";
import { interpolate, spring, useVideoConfig } from "remotion";
import type { StyleParams } from "../../../../lib/style-lab/schema";
import { ImportedStage, impTextStyle, useScaledFrame } from "./shared";

/**
 * Ported from reactvideoeditor/remotion-templates `cinematic-title-intro.tsx` (MIT).
 * Title springs up, flat accent underline grows, subtitle fades in.
 */
export const CinematicTitle: React.FC<StyleParams> = (props) => {
  const frame = useScaledFrame(props);
  const { fps } = useVideoConfig();
  const title = String(props.text ?? "Your Story Begins");
  const subtitle = String(props.subtitle ?? "");
  const accent = props.accentColor ?? "#E11D48";

  const titleY = spring({ frame, fps, from: 50, to: 0, durationInFrames: 40, config: { damping: 14, mass: 0.8 } });
  const titleOpacity = spring({ frame, fps, from: 0, to: 1, durationInFrames: 30 });
  const underlineWidth = interpolate(frame, [20, 50], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const subtitleOpacity = interpolate(frame, [40, 60], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <ImportedStage params={props}>
      <h1
        style={impTextStyle(props, {
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
          letterSpacing: "0.05em",
        })}
      >
        {title}
      </h1>
      <div
        style={{
          width: `${underlineWidth}%`,
          maxWidth: 320,
          height: 4,
          backgroundColor: accent,
          borderRadius: 2,
          marginTop: 16,
        }}
      />
      {subtitle !== "" && (
        <p
          style={impTextStyle(props, {
            fontSize: Number(props.fontSize ?? 52) * 0.4,
            fontWeight: 300,
            color: "#D4D4D8",
            opacity: subtitleOpacity,
            marginTop: 24,
            letterSpacing: "0.1em",
          })}
        >
          {subtitle}
        </p>
      )}
    </ImportedStage>
  );
};
