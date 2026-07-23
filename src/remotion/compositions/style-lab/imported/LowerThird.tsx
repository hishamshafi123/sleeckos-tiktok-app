import React from "react";
import { spring, useVideoConfig } from "remotion";
import type { StyleParams } from "../../../../lib/style-lab/schema";
import { ImportedStage, impTextStyle, useScaledFrame } from "./shared";

/**
 * Ported from reactvideoeditor/remotion-templates `lower-third.tsx` (MIT).
 * Accent rule + dark bar slide in from the left; name/role fade in.
 */
export const LowerThird: React.FC<StyleParams> = (props) => {
  const frame = useScaledFrame(props);
  const { fps } = useVideoConfig();
  const name = String(props.text ?? "Jane Cooper");
  const role = String(props.subtitle ?? "");
  const accent = props.accentColor ?? "#E11D48";

  const accentSlide = spring({ frame, fps, from: -300, to: 0, durationInFrames: 25, config: { damping: 15, mass: 0.6 } });
  const barSlide = spring({ frame: Math.max(0, frame - 5), fps, from: -400, to: 0, durationInFrames: 30, config: { damping: 14, mass: 0.7 } });
  const textOpacity = spring({ frame: Math.max(0, frame - 15), fps, from: 0, to: 1, durationInFrames: 20 });

  return (
    <ImportedStage params={props}>
      <div style={{ alignSelf: "flex-start", textAlign: "left" }}>
        <div
          style={{
            width: 200,
            height: 3,
            backgroundColor: accent,
            transform: `translateX(${accentSlide}px)`,
            borderRadius: 2,
            marginBottom: 4,
          }}
        />
        <div style={{ display: "flex", flexDirection: "row", transform: `translateX(${barSlide}px)` }}>
          <div style={{ width: 4, backgroundColor: accent, borderRadius: "2px 0 0 2px" }} />
          <div style={{ backgroundColor: "rgba(0, 0, 0, 0.7)", padding: "16px 32px", borderRadius: "0 4px 4px 0" }}>
            <div style={impTextStyle(props, { opacity: textOpacity, letterSpacing: "0.02em" })}>{name}</div>
            {role !== "" && (
              <div
                style={impTextStyle(props, {
                  fontSize: Number(props.fontSize ?? 34) * 0.62,
                  fontWeight: 300,
                  color: "#D4D4D8",
                  opacity: textOpacity,
                  marginTop: 4,
                  letterSpacing: "0.05em",
                })}
              >
                {role}
              </div>
            )}
          </div>
        </div>
      </div>
    </ImportedStage>
  );
};
