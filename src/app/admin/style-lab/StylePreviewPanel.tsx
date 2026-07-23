"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Player } from "@remotion/player";
import {
  Ban,
  ChevronDown,
  ChevronUp,
  Film,
  Grid2x2,
  GripHorizontal,
  Image as ImageIcon,
  Loader2,
  PictureInPicture2,
  Pin,
  Upload,
} from "lucide-react";

import { styleComponentFor, LayeredStyleComponent } from "@/remotion/compositions/style-lab/registry";
import { IMPORTED_CANVAS } from "@/remotion/compositions/style-lab/imported/shared";
import { importedTemplateMeta } from "@/lib/style-lab/imported";
import type { StyleLayer } from "@/lib/style-lab/layers";
import {
  SAMPLE_LYRIC_LINES,
  SAMPLE_QUOTE,
  STYLE_LAB_FPS,
  resolveCanvas,
  resolveDurationMs,
  type ParamField,
  type StyleFamily,
  type StyleParams,
} from "@/lib/style-lab/schema";
import { PreviewDragLayer } from "./PreviewDragLayer";

/**
 * Style Lab live preview: a dockable / floating panel around the Remotion
 * Player.
 *
 * The whole "stage" (background layer + Player + drag layer + footer
 * controls) is rendered through a single portal into a stable host element
 * that is re-parented in the DOM when the panel docks/floats/collapses —
 * so the Player never remounts except on template/aspect-ratio change,
 * exactly like the previous inline version.
 */

type PanelSize = "s" | "m" | "l";
const SIZE_WIDTHS: Record<PanelSize, number> = { s: 200, m: 280, l: 360 };

type BgMode = "checkerboard" | "video" | "none";
type RenderFormat = "video" | "still";

const CORNER_INSET = 16;
const CORNER_SNAP_DISTANCE = 48;

/** Honest checkerboard (inline SVG, no CSS gradients) shown behind transparent backgrounds. */
const CHECKERBOARD_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Crect width='16' height='16' fill='%2327272a'/%3E%3Crect width='8' height='8' fill='%233f3f46'/%3E%3Crect x='8' y='8' width='8' height='8' fill='%233f3f46'/%3E%3C/svg%3E\")";

export interface StylePreviewPanelProps {
  templateKey: string;
  family: StyleFamily;
  schema: ParamField[];
  params: StyleParams;
  onParamChange: (key: string, value: unknown) => void;
  fontsLoaded: boolean;
  renderBusy: RenderFormat | null;
  onRenderTest: (format: RenderFormat) => void;
  /** Layered styles: full stack → the layered-style comp + per-layer drag blocks. */
  layers?: StyleLayer[] | null;
  selectedLayerId?: string;
  onSelectLayer?: (id: string) => void;
  onLayerChange?: (id: string, patch: Partial<StyleLayer>) => void;
}

const iconBtn =
  "p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition focus:outline-none focus-visible:ring-1 focus-visible:ring-[#E11D48]";

export function StylePreviewPanel({
  templateKey,
  family,
  schema,
  params,
  onParamChange,
  fontsLoaded,
  renderBusy,
  onRenderTest,
  layers,
  selectedLayerId,
  onSelectLayer,
  onLayerChange,
}: StylePreviewPanelProps) {
  const [mode, setMode] = useState<"docked" | "floating">("docked");
  const [size, setSize] = useState<PanelSize>("m");
  const [collapsed, setCollapsed] = useState(false);
  const [pos, setPosState] = useState({ x: 0, y: 0 });
  const [animating, setAnimating] = useState(false);
  const [bgMode, setBgMode] = useState<BgMode>("checkerboard");
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [frameDims, setFrameDims] = useState({ w: 0, h: 0 });
  // Stable DOM node that hosts the portaled stage; re-parented (never
  // recreated) when the panel docks/floats so the Player stays mounted.
  const [hostEl] = useState<HTMLDivElement | null>(() => {
    if (typeof document === "undefined") return null;
    const el = document.createElement("div");
    el.style.width = "100%";
    return el;
  });

  const panelRef = useRef<HTMLDivElement | null>(null);
  const dockSlotRef = useRef<HTMLDivElement | null>(null);
  const floatSlotRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const headerDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const animateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const posRef = useRef(pos);

  const setPos = useCallback((p: { x: number; y: number }) => {
    posRef.current = p;
    setPosState(p);
  }, []);

  // ─── Derived player data (mirrors the previous inline preview) ────────────

  const importedMeta = importedTemplateMeta(templateKey);
  const isLayered = !importedMeta && !!layers && layers.length > 0;
  const inputProps = {
    ...params,
    lines: SAMPLE_LYRIC_LINES,
    quoteText: SAMPLE_QUOTE.quoteText,
    author: SAMPLE_QUOTE.author,
    ...(isLayered ? { layers } : {}),
  };
  // Imported comps render on a fixed 720×1280 canvas with a registry
  // duration; base/brat comps derive both from params + line timings.
  const canvas = importedMeta ? IMPORTED_CANVAS : resolveCanvas(params);
  const hasLyricBinding =
    isLayered && layers!.some((l) => l.visible && l.type === "text" && l.bind === "lyrics");
  const durationMs = importedMeta
    ? importedMeta.durationMs
    : isLayered && !hasLyricBinding
      ? 6000
      : resolveDurationMs(family, { lines: SAMPLE_LYRIC_LINES });
  const durationInFrames = Math.max(1, Math.round((durationMs / 1000) * STYLE_LAB_FPS));
  const aspectClass = !importedMeta && params.aspectRatio === "1:1" ? "aspect-square" : "aspect-[9/16]";
  const playerComponent = isLayered ? LayeredStyleComponent : styleComponentFor(templateKey, family);

  // ─── Stable portal host (keeps the Player mounted across dock/float) ──────

  useEffect(() => {
    return () => {
      hostEl?.remove();
      if (animateTimerRef.current) clearTimeout(animateTimerRef.current);
    };
  }, [hostEl]);

  useEffect(() => {
    if (!hostEl) return;
    const slot = mode === "docked" ? dockSlotRef.current : collapsed ? null : floatSlotRef.current;
    if (slot && hostEl.parentElement !== slot) slot.appendChild(hostEl);
  }, [hostEl, mode, collapsed]);

  // ─── Frame measurement (px↔percent mapping for the drag layer) ───────────

  const frameObserverRef = useRef<ResizeObserver | null>(null);
  const frameRef = useCallback((el: HTMLDivElement | null) => {
    frameObserverRef.current?.disconnect();
    frameObserverRef.current = null;
    if (el) {
      const update = () => setFrameDims({ w: el.clientWidth, h: el.clientHeight });
      update();
      const ro = new ResizeObserver(update);
      ro.observe(el);
      frameObserverRef.current = ro;
    }
  }, []);

  // ─── Uploaded background video lifecycle ──────────────────────────────────

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  const onFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setVideoUrl(URL.createObjectURL(file));
    setBgMode("video");
  };

  // ─── Floating panel: clamping, corner snap, header drag ───────────────────

  const clampPos = useCallback(
    (p: { x: number; y: number }) => {
      if (typeof window === "undefined") return p;
      const w = SIZE_WIDTHS[size];
      const h = panelRef.current?.offsetHeight ?? 200;
      return {
        x: Math.min(Math.max(p.x, 8), Math.max(8, window.innerWidth - w - 8)),
        y: Math.min(Math.max(p.y, 8), Math.max(8, window.innerHeight - h - 8)),
      };
    },
    [size]
  );

  useEffect(() => {
    if (mode !== "floating") return;
    setPos(clampPos(posRef.current));
    const onResize = () => setPos(clampPos(posRef.current));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [mode, size, collapsed, clampPos, setPos]);

  const snapToCornerIfClose = useCallback(() => {
    const w = SIZE_WIDTHS[size];
    const h = panelRef.current?.offsetHeight ?? 0;
    const corners = [
      { x: CORNER_INSET, y: CORNER_INSET },
      { x: window.innerWidth - w - CORNER_INSET, y: CORNER_INSET },
      { x: CORNER_INSET, y: window.innerHeight - h - CORNER_INSET },
      { x: window.innerWidth - w - CORNER_INSET, y: window.innerHeight - h - CORNER_INSET },
    ].map((c) => ({ x: Math.max(8, c.x), y: Math.max(8, c.y) }));
    const p = posRef.current;
    let best = corners[0];
    let bestDist = Infinity;
    for (const c of corners) {
      const dist = Math.hypot(c.x - p.x, c.y - p.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = c;
      }
    }
    if (bestDist <= CORNER_SNAP_DISTANCE) {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!reduced) {
        setAnimating(true);
        if (animateTimerRef.current) clearTimeout(animateTimerRef.current);
        animateTimerRef.current = setTimeout(() => setAnimating(false), 240);
      }
      setPos(best);
    }
  }, [size, setPos]);

  const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    headerDragRef.current = { startX: e.clientX, startY: e.clientY, origX: posRef.current.x, origY: posRef.current.y };
    setAnimating(false);
    const onMove = (ev: PointerEvent) => {
      const d = headerDragRef.current;
      if (!d) return;
      setPos(clampPos({ x: d.origX + ev.clientX - d.startX, y: d.origY + ev.clientY - d.startY }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      headerDragRef.current = null;
      snapToCornerIfClose();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const onHeaderKeyDown = (e: React.KeyboardEvent) => {
    if (mode !== "floating") return;
    const step = 16;
    let handled = true;
    const p = posRef.current;
    switch (e.key) {
      case "ArrowUp":
        setPos(clampPos({ x: p.x, y: p.y - step }));
        break;
      case "ArrowDown":
        setPos(clampPos({ x: p.x, y: p.y + step }));
        break;
      case "ArrowLeft":
        setPos(clampPos({ x: p.x - step, y: p.y }));
        break;
      case "ArrowRight":
        setPos(clampPos({ x: p.x + step, y: p.y }));
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  };

  const floatPanel = () => {
    const w = SIZE_WIDTHS[size];
    setPos({
      x: Math.max(8, window.innerWidth - w - CORNER_INSET),
      y: Math.max(8, window.innerHeight - 420 - CORNER_INSET),
    });
    setMode("floating");
  };

  const dockPanel = () => setMode("docked");

  // ─── Stage (portaled — travels between docked slot and floating panel) ────

  const stage = (
    <div className="space-y-2">
      <div
        ref={frameRef}
        className={`${aspectClass} w-full bg-[#040406] rounded-xl overflow-hidden border border-zinc-800 relative`}
      >
        {/* Background layer (behind the Player) */}
        <div
          className="absolute inset-0 z-0 pointer-events-none overflow-hidden"
          style={
            bgMode === "checkerboard"
              ? { backgroundImage: CHECKERBOARD_BG, backgroundSize: "16px 16px" }
              : { backgroundColor: "#18181b" }
          }
        >
          {bgMode === "video" && videoUrl && (
            <video src={videoUrl} className="w-full h-full object-cover" autoPlay muted loop playsInline />
          )}
        </div>

        {/* Player */}
        <div className="absolute inset-0 z-10">
          <Player
            key={`${isLayered ? "layered" : templateKey}-${importedMeta ? "9:16" : (params.aspectRatio ?? "9:16")}`}
            component={playerComponent}
            inputProps={inputProps}
            durationInFrames={durationInFrames}
            fps={STYLE_LAB_FPS}
            compositionWidth={canvas.width}
            compositionHeight={canvas.height}
            style={{ width: "100%", height: "100%" }}
            controls
            loop
            autoPlay
          />
        </div>

        {/* Canvas drag layer (position / margin / width; per-layer blocks when layered) */}
        {frameDims.w > 0 && frameDims.h > 0 && (
          <PreviewDragLayer
            frameWidth={frameDims.w}
            frameHeight={frameDims.h}
            canvasWidth={canvas.width}
            schema={schema}
            params={params}
            family={family}
            onParamChange={onParamChange}
            layers={isLayered ? layers! : undefined}
            selectedLayerId={selectedLayerId}
            onSelectLayer={onSelectLayer}
            onLayerChange={onLayerChange}
          />
        )}
      </div>

      {/* Footer: background switcher + test render */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div
          className="flex bg-zinc-950 border border-zinc-800 rounded p-0.5 text-[10px] font-semibold text-zinc-400"
          role="group"
          aria-label="Preview background"
        >
          <button
            onClick={() => setBgMode("checkerboard")}
            aria-pressed={bgMode === "checkerboard"}
            title="Checkerboard background (for transparent styles)"
            className={`px-1.5 py-1 rounded transition flex items-center gap-1 ${
              bgMode === "checkerboard" ? "bg-zinc-800 text-zinc-100" : "hover:text-zinc-200"
            }`}
          >
            <Grid2x2 size={11} />
            Checker
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            aria-pressed={bgMode === "video"}
            title="Preview over an uploaded video"
            className={`px-1.5 py-1 rounded transition flex items-center gap-1 ${
              bgMode === "video" ? "bg-zinc-800 text-zinc-100" : "hover:text-zinc-200"
            }`}
          >
            <Upload size={11} />
            Video
          </button>
          <button
            onClick={() => setBgMode("none")}
            aria-pressed={bgMode === "none"}
            title="Plain background"
            className={`px-1.5 py-1 rounded transition flex items-center gap-1 ${
              bgMode === "none" ? "bg-zinc-800 text-zinc-100" : "hover:text-zinc-200"
            }`}
          >
            <Ban size={11} />
            None
          </button>
        </div>

        <div className="flex gap-1">
          <button
            onClick={() => onRenderTest("video")}
            disabled={renderBusy !== null}
            title="Render test clip"
            aria-label="Render test clip"
            className="p-1.5 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 rounded transition disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#E11D48]"
          >
            {renderBusy === "video" ? <Loader2 size={12} className="animate-spin text-[#E11D48]" /> : <Film size={12} />}
          </button>
          <button
            onClick={() => onRenderTest("still")}
            disabled={renderBusy !== null}
            title="Render test still"
            aria-label="Render test still"
            className="p-1.5 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 rounded transition disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#E11D48]"
          >
            {renderBusy === "still" ? <Loader2 size={12} className="animate-spin text-[#E11D48]" /> : <ImageIcon size={12} />}
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        tabIndex={-1}
        aria-hidden
        onChange={onFileChosen}
      />
    </div>
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Docked card (middle editor column) */}
      <div className="border border-zinc-800 rounded-md bg-[#09090b] p-4 space-y-4">
        <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
          <Film size={13} className="text-[#E11D48]" />
          3. Live Preview
          <span className="ml-auto flex items-center gap-2 normal-case font-normal">
            {!fontsLoaded && (
              <span className="flex items-center gap-1 text-[10px] text-zinc-500">
                <Loader2 size={10} className="animate-spin" />
                Loading fonts…
              </span>
            )}
            {mode === "docked" && (
              <button
                onClick={floatPanel}
                title="Float the preview so it stays visible while scrolling"
                aria-label="Float preview panel"
                className={iconBtn}
              >
                <PictureInPicture2 size={13} />
              </button>
            )}
          </span>
        </h3>

        <div className="max-w-[320px] mx-auto w-full">
          <div ref={dockSlotRef} className="w-full" />
        </div>

        {mode === "floating" && (
          <div className="border border-dashed border-zinc-800 rounded-xl p-6 text-center space-y-3">
            <p className="text-[11px] text-zinc-500">The preview is floating over the page.</p>
            <button
              onClick={dockPanel}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 rounded transition text-[11px] font-semibold focus:outline-none focus-visible:ring-1 focus-visible:ring-[#E11D48]"
            >
              <Pin size={12} />
              Dock preview here
            </button>
          </div>
        )}

        <p className="text-[10px] text-zinc-600 text-center leading-normal">
          Every control re-renders instantly — the preview uses the same bundled TTF files as the server renderer.
          Drag a block in the preview to move it; drag its handles to resize. Layered styles show one block per layer.
        </p>
      </div>

      {/* Portaled stage (single instance shared by docked + floating) */}
      {hostEl && createPortal(stage, hostEl)}

      {/* Floating panel */}
      {mode === "floating" && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Floating live preview"
          className="fixed z-50"
          style={{
            left: pos.x,
            top: pos.y,
            width: SIZE_WIDTHS[size],
            transition: animating ? "left 0.2s ease, top 0.2s ease" : "none",
          }}
        >
          <div className="border border-zinc-800 rounded-md bg-[#09090b] shadow-2xl overflow-hidden">
            <div
              className="flex items-center gap-1.5 px-2 py-1.5 border-b border-zinc-800 cursor-grab active:cursor-grabbing select-none focus:outline-none focus-visible:ring-1 focus-visible:ring-[#E11D48]"
              style={{ touchAction: "none" }}
              onPointerDown={onHeaderPointerDown}
              onKeyDown={onHeaderKeyDown}
              tabIndex={0}
              aria-label="Preview panel. Drag to move; arrow keys move the panel."
            >
              <GripHorizontal size={12} className="text-zinc-600 shrink-0" />
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider flex-1 truncate">
                Live Preview
              </span>

              <div className="flex bg-zinc-950 border border-zinc-800 rounded p-px text-[9px] font-semibold text-zinc-500">
                {(["s", "m", "l"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSize(s)}
                    aria-label={`${s === "s" ? "Small" : s === "m" ? "Medium" : "Large"} preview size`}
                    aria-pressed={size === s}
                    className={`px-1.5 py-0.5 rounded uppercase transition focus:outline-none focus-visible:ring-1 focus-visible:ring-[#E11D48] ${
                      size === s ? "bg-zinc-800 text-zinc-100" : "hover:text-zinc-300"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>

              <button
                onClick={() => setCollapsed((c) => !c)}
                aria-label={collapsed ? "Expand preview" : "Collapse preview"}
                aria-expanded={!collapsed}
                title={collapsed ? "Expand" : "Collapse"}
                className={iconBtn}
              >
                {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
              </button>
              <button onClick={dockPanel} aria-label="Dock preview back into the editor" title="Dock" className={iconBtn}>
                <Pin size={12} />
              </button>
            </div>

            {!collapsed && (
              <div className="p-2">
                <div ref={floatSlotRef} className="w-full" />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
