import React from "react";
import { spring, useVideoConfig } from "remotion";
import type { StyleParams } from "../../../../lib/style-lab/schema";
import { ImportedStage, impTextStyle, useScaledFrame } from "./shared";

/**
 * Ported from reactvideoeditor/remotion-templates `bounce-text.tsx` (MIT).
 * Flat panel (no gradients) with title slide-in + delayed subtitle fade.
 */
export const BounceTitle: React.FC<StyleParams> = (props) => {
  const frame = useScaledFrame(props);
  const { fps } = useVideoConfig();
  const title = String(props.text ?? "Start Building");
  const subtitle = String(props.subtitle ?? "");
  const accent = props.accentColor ?? "#E11D48";

  const slideIn = spring({ frame, fps, from: -100, to: 0, config: { damping: 100, mass: 1, stiffness: 200 } });
  const fadeIn = spring({ frame: frame - 15, fps, from: 0, to: 1, config: { damping: 100, mass: 1 } });
  const scaleIn = spring({ frame, fps, from: 0.5, to: 1, config: { damping: 100, mass: 1, stiffness: 200 } });
  const containerFade = spring({ frame, fps, from: 0, to: 1, config: { damping: 100, mass: 1 } });

  return (
    <ImportedStage params={props}>
      <div
        style={{
          width: "100%",
          padding: "32px 40px",
          backgroundColor: "#18181B",
          border: "1px solid #27272A",
          borderLeft: `6px solid ${accent}`,
          borderRadius: 12,
          opacity: containerFade,
          transform: `scale(${scaleIn})`,
          textAlign: "left",
        }}
      >
        <div style={{ transform: `translateX(${slideIn}%)` }}>
          <h1 style={impTextStyle(props, { fontWeight: 900, lineHeight: 1.05 })}>{title}</h1>
          {subtitle !== "" && (
            <h2
              style={impTextStyle(props, {
                fontSize: Number(props.fontSize ?? 56) * 0.45,
                fontWeight: 500,
                opacity: fadeIn,
                marginTop: 14,
                color: "#D4D4D8",
              })}
            >
              {subtitle}
            </h2>
          )}
        </div>
      </div>
    </ImportedStage>
  );
};
