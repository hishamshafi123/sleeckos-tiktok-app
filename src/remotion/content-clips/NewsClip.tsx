import React, { useMemo } from "react";
import { AbsoluteFill, Img, Sequence, Video, useCurrentFrame } from "remotion";
import {
  captionChunks,
  FPS,
  OVERLAYS,
  type Draft,
  type Word,
} from "../../lib/content-clips/schema";
export type NewsClipProps = { src: string; draft: Draft; words: Word[] };
export function NewsClip({ src, draft, words }: NewsClipProps) {
  const frame = useCurrentFrame();
  const clipFrames = Math.max(1, Math.round((draft.end - draft.start) * FPS));
  const outro = frame >= clipFrames;
  const accent = OVERLAYS.find((p) => p.id === draft.overlay)!.accent;
  const captions = useMemo(
    () =>
      captionChunks(
        words.filter((w) => w.end > draft.start && w.start < draft.end),
      ),
    [words, draft.start, draft.end],
  );
  const seconds = draft.start + frame / FPS;
  const caption = captions.find((c) => seconds >= c.start && seconds <= c.end);
  return (
    <AbsoluteFill
      style={{
        background: "#09090b",
        color: "white",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <Sequence durationInFrames={clipFrames}>
        {src && (
          <Video
            src={src}
            trimBefore={Math.round(draft.start * FPS)}
            muted={draft.muted}
            style={{
              width: "100%",
              height: "100%",
              objectFit: draft.crop,
              objectPosition: `${draft.position}% center`,
            }}
          />
        )}
      </Sequence>
      {outro ? (
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            padding: 70,
            textAlign: "center",
            background: accent,
          }}
        >
          {draft.logo && (
            <Img
              src={draft.logo}
              style={{
                width: 130,
                height: 130,
                objectFit: "contain",
                marginBottom: 30,
              }}
            />
          )}
          <div
            style={{
              width: 80,
              height: 8,
              background: "white",
              marginBottom: 35,
            }}
          />
          <div
            style={{ fontSize: 56, fontWeight: 800, overflowWrap: "anywhere" }}
          >
            {draft.brand}
          </div>
          <div style={{ fontSize: 34, marginTop: 35 }}>
            {draft.outro === "follow"
              ? "Follow for local updates"
              : "Your state, informed"}
          </div>
        </AbsoluteFill>
      ) : (
        <>
          {draft.overlay !== "clean" && (
            <div
              style={{
                position: "absolute",
                top: 95,
                left: 45,
                right: 100,
                display: "flex",
              }}
            >
              {draft.logo && (
                <Img
                  src={draft.logo}
                  style={{
                    width: 72,
                    height: 72,
                    objectFit: "contain",
                    marginRight: 14,
                    background: "white",
                    borderRadius: 6,
                  }}
                />
              )}
              <span
                style={{
                  background: accent,
                  padding: "14px 20px",
                  fontSize: 25,
                  fontWeight: 700,
                  overflowWrap: "anywhere",
                }}
              >
                {draft.brand}
              </span>
            </div>
          )}
          {draft.hook && (
            <div
              style={{
                position: "absolute",
                left: 45,
                right: 100,
                top: draft.overlay === "headline" ? 185 : undefined,
                bottom: draft.overlay === "headline" ? undefined : 215,
                background:
                  draft.overlay === "clean" ? "rgba(0,0,0,.78)" : "#09090bf2",
                borderLeft: `8px solid ${accent}`,
                padding: "22px 24px",
                fontSize: draft.hook.length > 90 ? 32 : 40,
                lineHeight: 1.15,
                fontWeight: 800,
                overflowWrap: "anywhere",
              }}
            >
              {draft.hook}
            </div>
          )}
          {draft.captions && caption && (
            <div
              style={{
                position: "absolute",
                left: 50,
                right: 100,
                top: "48%",
                textAlign: "center",
                fontSize: 33,
                fontWeight: 700,
                textShadow: "0 2px 5px black",
                background: "rgba(0,0,0,.6)",
                padding: 12,
              }}
            >
              {caption.text}
            </div>
          )}
          {draft.credit && (
            <div
              style={{
                position: "absolute",
                left: 45,
                right: 100,
                bottom: 160,
                fontSize: 19,
                textShadow: "0 1px 4px black",
                overflowWrap: "anywhere",
              }}
            >
              Source: {draft.credit}
            </div>
          )}
        </>
      )}
    </AbsoluteFill>
  );
}
