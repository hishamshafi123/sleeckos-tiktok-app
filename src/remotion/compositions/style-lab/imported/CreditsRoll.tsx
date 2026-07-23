import React from "react";
import { useVideoConfig } from "remotion";
import type { StyleParams } from "../../../../lib/style-lab/schema";
import { ImportedStage, impTextStyle, textLines, useScaledFrame } from "./shared";

const FALLBACK_CREDITS = [
  { role: "Director", name: "Jane Smith" },
  { role: "Producer", name: "John Doe" },
];

/**
 * Ported from reactvideoeditor/remotion-templates `credits-roll.tsx` (MIT).
 * "Role: Name" lines scroll bottom-to-top on a flat background.
 */
export const CreditsRoll: React.FC<StyleParams> = (props) => {
  const frame = useScaledFrame(props);
  const { height } = useVideoConfig();
  const accent = props.accentColor ?? "#E11D48";

  const credits = textLines(props.text, []).map((line) => {
    const idx = line.indexOf(":");
    return idx > 0
      ? { role: line.slice(0, idx).trim(), name: line.slice(idx + 1).trim() }
      : { role: "", name: line };
  });
  const rows = credits.length > 0 ? credits : FALLBACK_CREDITS;

  const translateY = height - frame * 1.5;

  return (
    <ImportedStage params={props} fullBleed>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 40,
          transform: `translateY(${translateY}px)`,
          paddingTop: 32,
          width: "100%",
          textAlign: "center",
        }}
      >
        {rows.map((credit, i) => (
          <div key={i}>
            {credit.role !== "" && (
              <p
                style={impTextStyle(props, {
                  fontSize: Number(props.fontSize ?? 30) * 0.6,
                  fontWeight: 500,
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  color: accent,
                  marginBottom: 6,
                })}
              >
                {credit.role}
              </p>
            )}
            <p style={impTextStyle(props)}>{credit.name}</p>
          </div>
        ))}
      </div>
    </ImportedStage>
  );
};
