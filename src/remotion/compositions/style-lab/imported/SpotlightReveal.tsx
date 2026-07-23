import React from "react";
import { interpolate, useVideoConfig } from "remotion";
import type { StyleParams } from "../../../../lib/style-lab/schema";
import { ImportedStage, impTextStyle, useScaledFrame } from "./shared";

/**
 * Ported from reactvideoeditor/remotion-templates `spotlight-reveal.tsx` (MIT).
 * A circular clip grows from the center, revealing title + subtitle on a
 * flat dark panel (no gradients).
 */
export const SpotlightReveal: React.FC<StyleParams> = (props) => {
  const frame = useScaledFrame(props);
  const { durationInFrames, width, height } = useVideoConfig();
  const title = String(props.text ?? "REVEALED");
  const subtitle = String(props.subtitle ?? "");
  const accent = props.accentColor ?? "#E11D48";

  const radius = interpolate(frame, [0, durationInFrames * 0.8], [0, 75], { extrapolateRight: "clamp" });

  return (
    <ImportedStage params={props} fullBleed>
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: "#18181B",
          clipPath: `circle(${radius}% at 50% 50%)`,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          width,
          height,
        }}
      >
        <div style={{ width: 80, height: 4, backgroundColor: accent, borderRadius: 2, marginBottom: 24 }} />
        <h1 style={impTextStyle(props, { letterSpacing: "0.1em", textTransform: "uppercase" })}>{title}</h1>
        {subtitle !== "" && (
          <p
            style={impTextStyle(props, {
              fontSize: Number(props.fontSize ?? 56) * 0.35,
              fontWeight: 400,
              color: "#A1A1AA",
              marginTop: 12,
            })}
          >
            {subtitle}
          </p>
        )}
        <div style={{ width: 80, height: 4, backgroundColor: accent, borderRadius: 2, marginTop: 24 }} />
      </div>
    </ImportedStage>
  );
};
