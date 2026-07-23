import React from "react";
import { spring, useVideoConfig } from "remotion";
import type { StyleParams } from "../../../../lib/style-lab/schema";
import { ImportedStage, impTextStyle, useScaledFrame } from "./shared";

/**
 * Ported from reactvideoeditor/remotion-templates `title-split.tsx` (MIT).
 * Outlined top line drops from above, solid bottom line rises from below.
 */
export const TitleSplit: React.FC<StyleParams> = (props) => {
  const frame = useScaledFrame(props);
  const { fps } = useVideoConfig();
  const top = String(props.text ?? "CREATIVE");
  const bottom = String(props.subtitle ?? "STUDIO");
  const accent = props.accentColor ?? "#E11D48";

  const topY = spring({ frame, fps, config: { damping: 14, stiffness: 80 }, from: -120, to: 0 });
  const bottomY = spring({ frame, fps, config: { damping: 14, stiffness: 80 }, from: 120, to: 0 });

  const base = impTextStyle(props, {
    fontWeight: 800,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    lineHeight: 1.05,
  });

  return (
    <ImportedStage params={props}>
      <h1
        style={{
          ...base,
          color: "transparent",
          WebkitTextStroke: `2px ${props.textColor ?? "#FAFAFA"}`,
          transform: `translateY(${topY}px)`,
        }}
      >
        {top}
      </h1>
      <h1 style={{ ...base, color: accent, transform: `translateY(${bottomY}px)` }}>{bottom}</h1>
    </ImportedStage>
  );
};
