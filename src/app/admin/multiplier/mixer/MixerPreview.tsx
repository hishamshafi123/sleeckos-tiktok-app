"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { getFontFile } from "@/lib/fonts";
import {
  clipEdit,
  musicStart,
  type MixerLook,
  type MixerRecipeSnapshot,
  type MixerSettings,
} from "@/lib/campaign-mixer/schema";
import { MIXER_API, type Asset } from "./types";

export default function MixerPreview({
  recipe,
  clip,
  music,
  text,
  look,
  settings,
  renderedSample,
}: {
  recipe?: MixerRecipeSnapshot;
  clip?: Asset;
  music?: Asset;
  text?: string;
  look?: MixerLook;
  settings: MixerSettings;
  renderedSample?: string | null;
}) {
  const video = useRef<HTMLVideoElement>(null),
    audio = useRef<HTMLAudioElement>(null);
  const [safe, setSafe] = useState(true),
    [elapsed, setElapsed] = useState(10);
  const [playing, setPlaying] = useState(false);
  const source = recipe?.clip || clip,
    track = recipe?.music || music,
    style = recipe?.look || look,
    s = recipe?.settings || settings;
  let edit = recipe?.edit;
  try {
    if (!edit && source) edit = clipEdit(source);
  } catch {
    /* editable invalid trim is explained on save */
  }
  const start = recipe?.musicStart ?? (track ? musicStart(track) : 0);
  const fontFile = getFontFile(s.fontFamily, s.fontWeight);
  const sourceUrl = source ? `${MIXER_API}/media/${source.id}` : "";
  useEffect(() => {
    video.current?.pause();
    audio.current?.pause();
  }, [sourceUrl, recipe?.recipeKey, renderedSample]);
  useEffect(
    () => () => {
      audio.current?.pause();
    },
    [],
  );
  const syncAudio = (play = false) => {
    const v = video.current,
      a = audio.current;
    if (!v || !a || !track || !edit) return;
    const elapsedTime = Math.max(0, v.currentTime - edit.start);
    const remaining = Math.max(0.5, track.duration - start);
    const target =
      start + (s.loopMusic ? elapsedTime % remaining : elapsedTime);
    if (target >= track.duration) {
      a.pause();
      return;
    }
    if (Math.abs(a.currentTime - target) > 0.25) a.currentTime = target;
    a.volume = Math.min(
      1,
      s.musicVolume * (s.keepSourceAudio && s.duckMusic ? 0.45 : 1),
    );
    if (play) void a.play().catch(() => {});
  };
  const key = `${sourceUrl}:${recipe?.recipeKey || "draft"}:${renderedSample || ""}`;
  const fadeOpacity =
    playing && style?.settings.fade
      ? Math.min(1, elapsed / style.settings.fade)
      : 1;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-zinc-400">
        <span>{renderedSample ? "Rendered sample" : "Live preview"}</span>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={safe}
            onChange={(e) => setSafe(e.target.checked)}
            className="accent-rose-500"
          />
          TikTok guide
        </label>
      </div>
      <div
        className="relative mx-auto aspect-[9/16] w-full max-w-[300px] overflow-hidden rounded-xl bg-black ring-1 ring-zinc-700"
        style={{ containerType: "inline-size" }}
      >
        {fontFile && (
          <style>{`@font-face{font-family:'Mixer Preview';src:url('/${fontFile}') format('truetype');font-weight:${s.fontWeight};font-display:block;}`}</style>
        )}
        {source ? (
          <>
            <video
              key={key}
              ref={video}
              src={renderedSample || sourceUrl}
              controls
              playsInline
              preload="metadata"
              muted={!renderedSample && !s.keepSourceAudio}
              className="absolute inset-0 h-full w-full object-cover"
              style={
                renderedSample
                  ? {}
                  : {
                      objectPosition: `${(edit?.cropX ?? 0.5) * 100}% ${(edit?.cropY ?? 0.5) * 100}%`,
                      filter: style
                        ? `brightness(${1 + style.settings.brightness}) contrast(${style.settings.contrast}) saturate(${style.settings.saturation})`
                        : undefined,
                    }
              }
              onLoadedMetadata={() => {
                setPlaying(false);
                setElapsed(10);
                if (!renderedSample && video.current && edit)
                  video.current.currentTime = edit.start;
              }}
              onPlay={() => {
                setPlaying(true);
                if (!renderedSample) {
                  if (video.current)
                    video.current.volume = Math.min(1, s.sourceVolume);
                  syncAudio(true);
                }
              }}
              onPause={() => {
                setPlaying(false);
                audio.current?.pause();
              }}
              onSeeking={() => {
                if (!renderedSample) syncAudio(false);
              }}
              onTimeUpdate={() => {
                if (renderedSample || !video.current || !edit) return;
                setElapsed(Math.max(0, video.current.currentTime - edit.start));
                if (video.current.currentTime >= edit.end) {
                  video.current.pause();
                  video.current.currentTime = edit.start;
                  audio.current?.pause();
                } else syncAudio(!video.current.paused);
              }}
            />
            {!renderedSample && (
              <>
                {track && (
                  <audio
                    key={track.id}
                    ref={audio}
                    src={`${MIXER_API}/media/${track.id}`}
                    preload="metadata"
                  />
                )}
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{
                    background: `radial-gradient(ellipse, transparent 35%, rgba(0,0,0,${(style?.settings.vignette || 0) * 0.65}) 100%)`,
                    opacity: fadeOpacity,
                  }}
                />
                {recipe ? (
                  <Image
                    unoptimized
                    fill
                    sizes="300px"
                    alt="Approved text placement"
                    src={`${MIXER_API}/caption/${recipe.layout.path.split("/").pop()!.replace(".png", "")}`}
                    className="pointer-events-none absolute inset-0 h-full w-full"
                    style={{ opacity: fadeOpacity }}
                  />
                ) : (
                  text && (
                    <div
                      className="pointer-events-none absolute whitespace-pre-wrap text-white"
                      style={{
                        left: "12.8%",
                        width: "58%",
                        top:
                          (edit?.position ?? s.position) === "upper"
                            ? "25%"
                            : "45%",
                        fontFamily: "'Mixer Preview', sans-serif",
                        fontWeight: s.fontWeight,
                        fontSize: `${s.fontSize / 10.8}cqw`,
                        lineHeight: 1.22,
                        textAlign: s.align,
                        textShadow: "1px 1px 2px #000",
                        opacity: fadeOpacity,
                      }}
                    >
                      {text}
                    </div>
                  )
                )}
              </>
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-zinc-500">
            Select a clip to preview its framing.
          </div>
        )}
        {safe && (
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute left-[12%] top-[16%] h-[44%] w-[60%] border border-dashed border-emerald-300/75">
              <span className="absolute -top-5 left-0 text-[9px] text-emerald-200">
                Text safe area
              </span>
            </div>
            <div
              className="absolute right-2 top-[43%] flex flex-col gap-4 text-center text-white/55"
              aria-hidden="true"
            >
              <span>♡</span>
              <span>◯</span>
              <span>↗</span>
            </div>
            <div
              className="absolute bottom-[8%] left-[7%] right-[18%] space-y-1.5 opacity-40"
              aria-hidden="true"
            >
              <div className="h-1.5 w-1/3 rounded bg-white" />
              <div className="h-1 w-4/5 rounded bg-white" />
              <div className="h-1 w-3/5 rounded bg-white" />
            </div>
          </div>
        )}
      </div>
      <p className="text-[11px] leading-relaxed text-zinc-500">
        {renderedSample
          ? "This sample uses the final renderer and the approved settings."
          : "Preview the framing here. Use Render sample to check final color, fades, and audio mixing."}{" "}
        The guide is conservative; TikTok layouts vary by device and caption.
      </p>
    </div>
  );
}
