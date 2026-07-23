import React from "react";
import { spring, useVideoConfig } from "remotion";
import type { StyleParams } from "../../../../lib/style-lab/schema";
import { ImportedStage, impTextStyle, useScaledFrame } from "./shared";

/**
 * Ported from reactvideoeditor/remotion-templates `floating-bubble-text.tsx` (MIT).
 * Pill text springing in, then gently bobbing (flat colors, no gradients).
 */
export const FloatingBubble: React.FC<StyleParams> = (props) => {
  const frame = useScaledFrame(props);
  const { fps } = useVideoConfig();
  const text = String(props.text ?? "floating");
  const pill = props.accentColor ?? "#18181B";

  const float = Math.sin(frame / 30) * 14;
  const scale = spring({ frame, fps, from: 0, to: 1, config: { damping: 12, mass: 0.5 } });

  return (
    <ImportedStage params={props}>
      <div
        style={{
          ...impTextStyle(props),
          padding: "24px 44px",
          borderRadius: 999,
          backgroundColor: pill,
          border: "1px solid #3F3F46",
          transform: `translateY(${float}px) scale(${scale})`,
        }}
      >
        {text}
      </div>
    </ImportedStage>
  );
};
