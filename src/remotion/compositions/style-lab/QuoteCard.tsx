import React from "react";
import {
  AbsoluteFill,
  CalculateMetadataFunction,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  SAMPLE_QUOTE,
  STYLE_LAB_FPS,
  resolveCanvas,
  type StyleParams,
} from "../../../lib/style-lab/schema";
import {
  EffectOverlays,
  PixelateFilterDefs,
  buildTextStyle,
  contentFilter,
  exitOpacity,
  useEntry,
} from "./shared";

export type QuoteCardProps = StyleParams & { quoteText?: string; author?: string };

const ALIGN_ITEMS: Record<string, React.CSSProperties["alignItems"]> = {
  left: "flex-start",
  center: "center",
  right: "flex-end",
};

/**
 * Quote / statement card. Style params come from QUOTE_PARAM_SCHEMA;
 * content props (quoteText, author) are passed per render.
 * highlightColor drives the accent: quote mark, author dash.
 */
export const QuoteCard: React.FC<QuoteCardProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const params = props;
  const quoteText = props.quoteText || SAMPLE_QUOTE.quoteText;
  const author = props.author ?? SAMPLE_QUOTE.author;

  const entry = useEntry(params, 0);
  const exit = exitOpacity(params, frame, fps, durationInFrames);

  const bg = params.bgColor ?? "#09090B";
  const alignmentKey = params.alignment ?? "center";
  const alignment = alignmentKey as React.CSSProperties["textAlign"];
  const pad = Number(params.padding ?? 24);
  const stripOpacity = Number(params.stripOpacity ?? 0);
  const fontSize = Number(params.fontSize ?? 48);
  const highlight = params.highlightColor ?? "#E11D48";
  const textStyle = buildTextStyle(params);

  return (
    <AbsoluteFill style={{ backgroundColor: bg === "transparent" ? "transparent" : bg }}>
      <PixelateFilterDefs />
      <div
        style={{
          position: "absolute",
          top: `${Number(params.positionYPercent ?? 50)}%`,
          left: Number(params.marginX ?? 56),
          right: Number(params.marginX ?? 56),
          transform: "translateY(-50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: ALIGN_ITEMS[alignmentKey] ?? "center",
          filter: contentFilter(params),
        }}
      >
        <div
          style={{
            position: "relative",
            maxWidth: `${Number(params.maxWidthPercent ?? 85)}%`,
            opacity: entry.opacity * exit,
            transform: entry.transform,
          }}
        >
          {stripOpacity > 0 && (
            <div
              style={{
                position: "absolute",
                top: -pad,
                bottom: -pad,
                left: -pad,
                right: -pad,
                backgroundColor: params.stripColor ?? "#000000",
                opacity: Math.max(0, Math.min(1, stripOpacity)),
                borderRadius: 12,
              }}
            />
          )}

          <div
            style={{
              position: "relative",
              display: "flex",
              flexDirection: "column",
              alignItems: ALIGN_ITEMS[alignmentKey] ?? "center",
              gap: `${Math.round(fontSize * 0.55)}px`,
            }}
          >
            {/* Decorative quote mark (accent) */}
            <span
              style={{
                fontFamily: "Georgia, serif",
                fontSize: `${Math.round(fontSize * 1.9)}px`,
                lineHeight: 0.6,
                color: highlight,
                opacity: 0.9,
              }}
            >
              “
            </span>

            <div style={{ ...textStyle, textAlign: alignment }}>{quoteText}</div>

            {author !== "" && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  alignSelf: alignmentKey === "center" ? "center" : ALIGN_ITEMS[alignmentKey] === "flex-end" ? "flex-end" : "flex-start",
                }}
              >
                <span style={{ width: 28, height: 2, backgroundColor: highlight, display: "inline-block" }} />
                <span
                  style={{
                    fontFamily: textStyle.fontFamily,
                    fontWeight: 600,
                    fontSize: `${Math.round(fontSize * 0.42)}px`,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: params.textColor ?? "#FFFFFF",
                    opacity: 0.7,
                  }}
                >
                  {author}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
      <EffectOverlays params={params} />
    </AbsoluteFill>
  );
};

export const quoteCardCalculateMetadata: CalculateMetadataFunction<QuoteCardProps> = ({ props }) => {
  const { width, height } = resolveCanvas(props);
  return {
    width,
    height,
    durationInFrames: Math.round((6000 / 1000) * STYLE_LAB_FPS),
  };
};
