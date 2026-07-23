import React from "react";
import type { StyleParams } from "../../../../lib/style-lab/schema";
import { ImportedStage, impTextStyle, useScaledFrame } from "./shared";

/**
 * Ported from reactvideoeditor/remotion-templates `glitch-text.tsx` (MIT).
 * RGB-split layers jittering against the base text.
 */
export const GlitchText: React.FC<StyleParams> = (props) => {
  const frame = useScaledFrame(props);
  const text = String(props.text ?? "GLITCH");
  const accent = props.accentColor ?? "#E11D48";

  const jitter = Math.sin(frame / 10) * 10;
  const offset = Math.sin(frame / 5) * 5;
  const style = impTextStyle(props, { fontWeight: 900, whiteSpace: "pre-wrap" as const });

  return (
    <ImportedStage params={props}>
      <div style={{ position: "relative" }}>
        <div
          aria-hidden
          style={{ ...style, position: "absolute", inset: 0, color: accent, transform: `translate(${offset}px, ${jitter}px)`, mixBlendMode: "screen" }}
        >
          {text}
        </div>
        <div
          aria-hidden
          style={{ ...style, position: "absolute", inset: 0, color: "#22D3EE", transform: `translate(${-offset}px, ${-jitter}px)`, mixBlendMode: "screen" }}
        >
          {text}
        </div>
        <div style={{ ...style, position: "relative", opacity: 0.9 }}>{text}</div>
      </div>
    </ImportedStage>
  );
};
