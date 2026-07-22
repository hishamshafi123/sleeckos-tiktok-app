import React from "react";
import {
  AbsoluteFill,
  CalculateMetadataFunction,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  SAMPLE_LYRIC_LINES,
  STYLE_LAB_FPS,
  resolveCanvas,
  resolveDurationMs,
  type LyricLine,
  type StyleParams,
} from "../../../lib/style-lab/schema";
import {
  EffectOverlays,
  PixelateFilterDefs,
  buildTextStyle,
  contentFilter,
  exitOpacity,
  useEntry,
  wordTimings,
} from "./shared";

export type LyricCaptionProps = StyleParams & { lines?: LyricLine[] };

const ALIGN_ITEMS: Record<string, React.CSSProperties["alignItems"]> = {
  left: "flex-start",
  center: "center",
  right: "flex-end",
};

/**
 * One rendered caption block. When `karaoke` is set the line renders as
 * word-level spans colored by singing progress (sung = textColor,
 * active = highlightColor, upcoming = dimmed textColor).
 */
const LineBlock: React.FC<{
  params: StyleParams;
  /** Line with timing already shifted by timingOffsetMs. */
  line: LyricLine;
  isActive: boolean;
  /** Current time in ms. */
  t: number;
  karaoke: boolean;
}> = ({ params, line, isActive, t, karaoke }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const startFrame = (line.startMs / 1000) * fps;
  const endFrame = (line.endMs / 1000) * fps;
  const entry = useEntry(params, isActive ? startFrame : 0);
  const dim = isActive ? 1 : 0.45;
  const exit = isActive ? exitOpacity(params, frame, fps, endFrame) : 1;

  const alignment = (params.alignment ?? "center") as React.CSSProperties["textAlign"];
  const pad = Number(params.padding ?? 16);
  const stripOpacity = Number(params.stripOpacity ?? 0);

  let body: React.ReactNode = line.text;
  if (karaoke && isActive) {
    const words = wordTimings(line.text, line.startMs, line.endMs);
    body = words.map((w, i) => {
      const state = t >= w.endMs ? "sung" : t >= w.startMs ? "active" : "upcoming";
      return (
        <span
          key={i}
          style={{
            color: state === "active" ? (params.highlightColor ?? "#E11D48") : (params.textColor ?? "#FFFFFF"),
            opacity: state === "upcoming" ? 0.45 : 1,
          }}
        >
          {w.word}
          {i < words.length - 1 ? " " : ""}
        </span>
      );
    });
  }

  return (
    <div
      style={{
        position: "relative",
        maxWidth: `${Number(params.maxWidthPercent ?? 90)}%`,
        opacity: entry.opacity * dim * exit,
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
            borderRadius: 8,
          }}
        />
      )}
      <div style={{ ...buildTextStyle(params), textAlign: alignment, position: "relative" }}>
        {body}
      </div>
    </div>
  );
};

export const LyricCaption: React.FC<LyricCaptionProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const params = props;
  const offset = Number(params.timingOffsetMs ?? 0);
  const rawLines = props.lines && props.lines.length > 0 ? props.lines : SAMPLE_LYRIC_LINES;
  const lines = rawLines.map((l) => ({
    ...l,
    startMs: l.startMs + offset,
    endMs: l.endMs + offset,
  }));

  const t = (frame / fps) * 1000;
  const mode = params.lineMode ?? "karaoke";
  const linesVisible = Math.max(1, Math.min(3, Math.round(Number(params.linesVisible ?? 2))));
  const activeIdx = lines.findIndex((l) => t >= l.startMs && t < l.endMs);

  const bg = params.bgColor ?? "#18181B";
  const alignmentKey = params.alignment ?? "center";
  const fontSize = Number(params.fontSize ?? 44);
  const lineHeight = Number(params.lineHeight ?? 1.25);

  let content: React.ReactNode = null;
  if (activeIdx >= 0) {
    if (mode === "word-by-word") {
      const words = wordTimings(lines[activeIdx].text, lines[activeIdx].startMs, lines[activeIdx].endMs);
      const wi = words.findIndex((w) => t >= w.startMs && t < w.endMs);
      if (wi >= 0) {
        const w = words[wi];
        content = (
          <LineBlock
            key={`${activeIdx}-${wi}`}
            params={params}
            line={{ text: w.word, startMs: w.startMs, endMs: w.endMs }}
            isActive
            t={t}
            karaoke={false}
          />
        );
      }
    } else {
      content = lines
        .slice(activeIdx, activeIdx + linesVisible)
        .map((line, i) => (
          <LineBlock
            key={activeIdx + i}
            params={params}
            line={line}
            isActive={i === 0}
            t={t}
            karaoke={mode === "karaoke"}
          />
        ));
    }
  }

  return (
    <AbsoluteFill style={{ backgroundColor: bg === "transparent" ? "transparent" : bg }}>
      <PixelateFilterDefs />
      <div
        style={{
          position: "absolute",
          top: `${Number(params.positionYPercent ?? 50)}%`,
          left: Number(params.marginX ?? 48),
          right: Number(params.marginX ?? 48),
          transform: "translateY(-50%)",
          display: "flex",
          flexDirection: "column",
          gap: `${Math.round(fontSize * lineHeight * 0.45)}px`,
          alignItems: ALIGN_ITEMS[alignmentKey] ?? "center",
          filter: contentFilter(params),
        }}
      >
        {content}
      </div>
      <EffectOverlays params={params} />
    </AbsoluteFill>
  );
};

export const lyricCaptionCalculateMetadata: CalculateMetadataFunction<LyricCaptionProps> = ({
  props,
}) => {
  const { width, height } = resolveCanvas(props);
  const lines = props.lines && props.lines.length > 0 ? props.lines : SAMPLE_LYRIC_LINES;
  const durationMs = resolveDurationMs("lyric", { lines });
  return {
    width,
    height,
    durationInFrames: Math.max(1, Math.round((durationMs / 1000) * STYLE_LAB_FPS)),
  };
};
