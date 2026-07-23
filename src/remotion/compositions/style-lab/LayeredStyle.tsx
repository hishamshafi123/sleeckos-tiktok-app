import React from "react";
import {
  AbsoluteFill,
  CalculateMetadataFunction,
  Img,
  staticFile,
  useVideoConfig,
} from "remotion";
import {
  SAMPLE_LYRIC_LINES,
  SAMPLE_QUOTE,
  STYLE_LAB_FPS,
  resolveCanvas,
  resolveDurationMs,
  type LyricLine,
  type StyleParams,
} from "../../../lib/style-lab/schema";
import {
  coerceLayers,
  type StyleLayer,
} from "../../../lib/style-lab/layers";
import {
  EffectOverlays,
  PixelateFilterDefs,
  buildTextStyle,
  useEntry,
} from "./shared";
import { LyricLines } from "./LyricCaption";

export type LayeredStyleProps = StyleParams & {
  layers?: StyleLayer[];
  lines?: LyricLine[];
  quoteText?: string;
  author?: string;
};

/**
 * Layered Style — renders ANY Style Lab layer stack (text / image / shape)
 * on one canvas. Layers are positioned by percent-of-canvas transforms
 * (x/y = block center) and composited in array order (zIndex).
 *
 * A text layer with bind="lyrics" renders the item's lyric lines with the
 * same word/line/karaoke engine as lyric-caption (LyricLines); its line
 * behavior (lineMode/linesVisible/timingOffsetMs) and per-line entry come
 * from the flat params, its typography from the layer. bind="quote" renders
 * the quoteText prop; unbound text layers render their static `text`.
 *
 * Global params (bgColor, aspectRatio, effects) still come from the flat
 * params object — the layer stack only replaces per-block layout/typography.
 */

/** Layer typography → the StyleParams shape buildTextStyle understands. */
function layerTextParams(layer: StyleLayer): StyleParams {
  return {
    fontFamily: layer.fontFamily ?? "Inter",
    fontWeight: layer.fontWeight ?? 700,
    italic: layer.italic ?? false,
    fontSize: layer.fontSize ?? 44,
    letterSpacing: layer.letterSpacing ?? 0,
    lineHeight: layer.lineHeight ?? 1.25,
    textTransform: layer.textTransform ?? "none",
    textColor: layer.textColor ?? "#FFFFFF",
    shadow: false,
    outlineWidth: 0,
  };
}

const TextContent: React.FC<{ layer: StyleLayer; props: LayeredStyleProps }> = ({
  layer,
  props,
}) => {
  const typo = layerTextParams(layer);
  const alignment = (layer.alignment ?? "center") as React.CSSProperties["textAlign"];

  if (layer.bind === "lyrics") {
    const rawLines = props.lines && props.lines.length > 0 ? props.lines : SAMPLE_LYRIC_LINES;
    // Flat params supply the lyric engine behavior; the layer supplies
    // typography + karaoke colors. maxWidth/strip are layer-local (off).
    const lyricParams: StyleParams = {
      ...props,
      ...typo,
      highlightColor: layer.highlightColor ?? "#E11D48",
      alignment: layer.alignment ?? "center",
      maxWidthPercent: 100,
      stripOpacity: 0,
    };
    return <LyricLines params={lyricParams} lines={rawLines} />;
  }

  const text =
    layer.bind === "quote"
      ? (props.quoteText || SAMPLE_QUOTE.quoteText)
      : (layer.text ?? "");
  if (!text) return null;
  return <div style={{ ...buildTextStyle(typo), textAlign: alignment }}>{text}</div>;
};

const LayerView: React.FC<{ layer: StyleLayer; props: LayeredStyleProps }> = ({
  layer,
  props,
}) => {
  const { fps, height } = useVideoConfig();

  const startFrame = (Number(layer.delayMs ?? 0) / 1000) * fps;
  const entry = useEntry(layer as unknown as StyleParams, startFrame);

  const inner = (() => {
    switch (layer.type) {
      case "text":
        return <TextContent layer={layer} props={props} />;
      case "image": {
        const url = layer.imageUrl ?? "";
        if (!url) return null;
        const src = url.startsWith("/") ? staticFile(url.slice(1)) : url;
        return <Img src={src} style={{ width: "100%", height: "auto", display: "block" }} />;
      }
      case "shape":
        return (
          <div
            style={{
              width: "100%",
              height: Math.max(1, ((layer.heightPercent ?? 12) / 100) * height),
              backgroundColor: layer.shapeColor ?? "#000000",
              opacity: Math.max(0, Math.min(1, layer.shapeOpacity ?? 0.6)),
              borderRadius: Number(layer.borderRadius ?? 0),
            }}
          />
        );
      default:
        return null;
    }
  })();

  if (!inner) return null;

  return (
    <div
      style={{
        position: "absolute",
        left: `${layer.xPercent}%`,
        top: `${layer.yPercent}%`,
        width: `${layer.widthPercent}%`,
        transform: `translate(-50%, -50%)${entry.transform ? ` ${entry.transform}` : ""}`,
        opacity: entry.opacity,
        zIndex: layer.zIndex,
      }}
    >
      {inner}
    </div>
  );
};

export const LayeredStyle: React.FC<LayeredStyleProps> = (props) => {
  const layers = coerceLayers(props.layers);
  const bg = props.bgColor ?? "transparent";

  return (
    <AbsoluteFill style={{ backgroundColor: bg === "transparent" ? "transparent" : bg }}>
      <PixelateFilterDefs />
      {layers
        .filter((l) => l.visible)
        .map((layer) => (
          <LayerView key={layer.id} layer={layer} props={props} />
        ))}
      <EffectOverlays params={props} />
    </AbsoluteFill>
  );
};

export const layeredStyleCalculateMetadata: CalculateMetadataFunction<LayeredStyleProps> = ({
  props,
}) => {
  const { width, height } = resolveCanvas(props);
  const layers = coerceLayers(props.layers);
  const hasLyrics = layers.some((l) => l.visible && l.type === "text" && l.bind === "lyrics");
  const lines = props.lines && props.lines.length > 0 ? props.lines : SAMPLE_LYRIC_LINES;
  const durationMs = hasLyrics
    ? resolveDurationMs("lyric", { lines })
    : resolveDurationMs("quote", {});
  return {
    width,
    height,
    durationInFrames: Math.max(1, Math.round((durationMs / 1000) * STYLE_LAB_FPS)),
  };
};
