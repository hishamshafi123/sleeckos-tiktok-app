import React from "react";
import { spring, useVideoConfig } from "remotion";
import type { StyleParams } from "../../../../lib/style-lab/schema";
import { ImportedStage, impTextStyle, useScaledFrame } from "./shared";

/**
 * Ported from reactvideoeditor/remotion-templates `slide-text.tsx` (MIT).
 * Title slides in from the left; subtitle follows with a fade.
 */
export const SlideText: React.FC<StyleParams> = (props) => {
  const frame = useScaledFrame(props);
  const { fps } = useVideoConfig();
  const title = String(props.text ?? "Slide right in");
  const subtitle = String(props.subtitle ?? "");
  const accent = props.accentColor ?? "#E11D48";

  const slideX = spring({ frame, fps, from: -80, to: 0, config: { damping: 14, mass: 0.8, stiffness: 120 } });
  const opacity = spring({ frame, fps, from: 0, to: 1, config: { damping: 14, mass: 0.8 } });
  const subOpacity = spring({ frame: frame - 12, fps, from: 0, to: 1, config: { damping: 14, mass: 0.8 } });

  return (
    <ImportedStage params={props}>
      <div style={{ textAlign: "left", alignSelf: "flex-start", opacity, transform: `translateX(${slideX}px)` }}>
        <h1 style={impTextStyle(props, { fontWeight: 800 })}>{title}</h1>
        <div style={{ width: 72, height: 4, backgroundColor: accent, borderRadius: 2, marginTop: 14 }} />
        {subtitle !== "" && (
          <p
            style={impTextStyle(props, {
              fontSize: Number(props.fontSize ?? 60) * 0.45,
              fontWeight: 500,
              color: "#D4D4D8",
              opacity: subOpacity,
              marginTop: 14,
            })}
          >
            {subtitle}
          </p>
        )}
      </div>
    </ImportedStage>
  );
};
