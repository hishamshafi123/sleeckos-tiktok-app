import React from "react";
import { interpolate } from "remotion";
import type { StyleParams } from "../../../../lib/style-lab/schema";
import { ImportedStage, impTextStyle, useScaledFrame } from "./shared";

/**
 * Ported from reactvideoeditor/remotion-templates `typewriter-subtitle.tsx` (MIT).
 * Characters appear left-to-right with a blinking block cursor.
 */
export const Typewriter: React.FC<StyleParams> = (props) => {
  const frame = useScaledFrame(props);
  const text = String(props.text ?? "i like typing…");
  const accent = props.accentColor ?? "#E11D48";

  const visible = Math.floor(
    interpolate(frame, [0, 45], [0, text.length], { extrapolateRight: "clamp" }),
  );
  const fontSize = Number(props.fontSize ?? 44);

  return (
    <ImportedStage params={props}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "baseline" }}>
        <span style={{ ...impTextStyle(props), whiteSpace: "pre-wrap" }}>
          {text.slice(0, visible)}
        </span>
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: Math.max(4, fontSize * 0.12),
            height: fontSize,
            marginLeft: 4,
            backgroundColor: accent,
            opacity: frame % 16 < 8 ? 1 : 0,
            transform: "translateY(4px)",
          }}
        />
      </div>
    </ImportedStage>
  );
};
