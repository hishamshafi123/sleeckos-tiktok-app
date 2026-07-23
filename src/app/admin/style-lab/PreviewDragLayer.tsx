"use client";

import React, { useRef, useState } from "react";
import type { ParamField, StyleFamily, StyleParams } from "@/lib/style-lab/schema";
import type { StyleLayer } from "@/lib/style-lab/layers";

/**
 * Canvas drag layer for the Style Lab preview.
 *
 * Sits above the Remotion Player (pointer-events: none except on the blocks
 * themselves, so player controls stay reachable).
 *
 * Two modes:
 *  - Legacy single-block (no `layers` prop): maps drags onto the flat layout
 *    params the base compositions consume (positionYPercent / marginX /
 *    maxWidthPercent, fontSize fallback).
 *  - Multi-layer (`layers` prop set): one drag block per layer; drags write
 *    the layer's xPercent / yPercent / widthPercent via onLayerChange and
 *    clicking a block selects it (same snap guides).
 *
 * All writes go through the parent's state, so the control panel sliders
 * and the canvas blocks stay in two-way sync.
 */

const SNAP_PX = 8;

export interface PreviewDragLayerProps {
  /** CSS pixel size of the preview frame. */
  frameWidth: number;
  frameHeight: number;
  /** Composition pixel size (e.g. 720×1280). */
  canvasWidth: number;
  schema: ParamField[];
  params: StyleParams;
  family: StyleFamily;
  onParamChange: (key: string, value: unknown) => void;
  /** Multi-layer mode — when provided, per-layer blocks replace the legacy block. */
  layers?: StyleLayer[];
  selectedLayerId?: string;
  onSelectLayer?: (id: string) => void;
  onLayerChange?: (id: string, patch: Partial<StyleLayer>) => void;
}

function fieldOf(schema: ParamField[], key: string): ParamField | undefined {
  return schema.find((f) => f.key === key);
}

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampToField(field: ParamField | undefined, v: number, fbMin: number, fbMax: number): number {
  const min = field?.min ?? fbMin;
  const max = field?.max ?? fbMax;
  return Math.min(max, Math.max(min, v));
}

function stepRound(field: ParamField | undefined, v: number): number {
  const step = field?.step ?? 1;
  return Math.round(v / step) * step;
}

const GuideV: React.FC<{ leftPct: number }> = ({ leftPct }) => (
  <div className="absolute top-0 bottom-0 w-px bg-[#E11D48]/80" style={{ left: `${leftPct}%` }} />
);
const GuideH: React.FC<{ topPct: number }> = ({ topPct }) => (
  <div className="absolute left-0 right-0 h-px bg-[#E11D48]/80" style={{ top: `${topPct}%` }} />
);

export function PreviewDragLayer(props: PreviewDragLayerProps) {
  if (props.layers) {
    if (props.frameWidth <= 0 || props.frameHeight <= 0) return null;
    return <MultiLayerDrag {...props} layers={props.layers} />;
  }
  return <LegacyDragBlock {...props} />;
}

// ─── Multi-layer mode ────────────────────────────────────────────────────────

interface LayerDragState {
  layerId: string;
  mode: "move" | "resize-l" | "resize-r";
  startX: number;
  startY: number;
  startXPct: number;
  startYPct: number;
  startWPct: number;
}

/** Estimated CSS-pixel height of a layer block (affordance, not pixel-perfect). */
function layerBoxHeight(layer: StyleLayer, boxW: number, frameHeight: number, scale: number): number {
  if (layer.type === "shape") {
    return Math.max(10, ((layer.heightPercent ?? 12) / 100) * frameHeight);
  }
  if (layer.type === "image") {
    return Math.max(16, boxW * 0.75);
  }
  const fontSize = Number(layer.fontSize ?? 44);
  const lineHeight = Number(layer.lineHeight ?? 1.25);
  const lines = layer.bind === "lyrics" ? 2 : 1.4;
  return Math.max(18, (fontSize * lineHeight * lines) / scale);
}

function MultiLayerDrag({
  frameWidth,
  frameHeight,
  canvasWidth,
  layers,
  selectedLayerId,
  onSelectLayer,
  onLayerChange,
}: PreviewDragLayerProps & { layers: StyleLayer[] }) {
  const [guides, setGuides] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const dragRef = useRef<LayerDragState | null>(null);

  const scale = canvasWidth / frameWidth;

  const snapPct = (v: number, framePx: number, targets: [number, string][], out: string[]): number => {
    for (const [target, key] of targets) {
      if (Math.abs(((v - target) / 100) * framePx) <= SNAP_PX) {
        out.push(key);
        return target;
      }
    }
    return v;
  };

  const handleMove = (clientX: number, clientY: number) => {
    const d = dragRef.current;
    if (!d || !onLayerChange) return;
    const dx = clientX - d.startX;
    const dy = clientY - d.startY;
    const nextGuides: string[] = [];

    if (d.mode === "move") {
      let x = Math.min(100, Math.max(0, d.startXPct + (dx / frameWidth) * 100));
      let y = Math.min(100, Math.max(0, d.startYPct + (dy / frameHeight) * 100));
      x = snapPct(x, frameWidth, [[50, "v-center"], [5, "v-safe-l"], [95, "v-safe-r"]], nextGuides);
      y = snapPct(y, frameHeight, [[50, "h-center"], [5, "h-safe-top"], [95, "h-safe-bottom"]], nextGuides);
      onLayerChange(d.layerId, {
        xPercent: Math.round(x * 2) / 2,
        yPercent: Math.round(y * 2) / 2,
      });
    } else {
      const dir = d.mode === "resize-l" ? -1 : 1;
      // Centered blocks grow symmetrically: a handle drag of dx changes the
      // width by 2·dx.
      let w = Math.min(100, Math.max(2, d.startWPct + ((dir * dx * 2) / frameWidth) * 100));
      w = snapPct(w, frameWidth, [[100, "v-full"], [50, "v-center"]], nextGuides);
      onLayerChange(d.layerId, { widthPercent: Math.round(w) });
    }
    setGuides(nextGuides);
  };

  const endDrag = () => {
    dragRef.current = null;
    setActiveId("");
    setGuides([]);
  };

  const beginDrag = (e: React.PointerEvent, layer: StyleLayer, mode: LayerDragState["mode"]) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onSelectLayer?.(layer.id);
    dragRef.current = {
      layerId: layer.id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      startXPct: layer.xPercent,
      startYPct: layer.yPercent,
      startWPct: layer.widthPercent,
    };
    setActiveId(layer.id);
    const onMove = (ev: PointerEvent) => handleMove(ev.clientX, ev.clientY);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      endDrag();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const onKeyDown = (e: React.KeyboardEvent, layer: StyleLayer) => {
    if (!onLayerChange) return;
    const clamp = (v: number) => Math.min(100, Math.max(0, Math.round(v)));
    let handled = true;
    switch (e.key) {
      case "ArrowUp":
        onLayerChange(layer.id, { yPercent: clamp(layer.yPercent - 1) });
        break;
      case "ArrowDown":
        onLayerChange(layer.id, { yPercent: clamp(layer.yPercent + 1) });
        break;
      case "ArrowLeft":
        onLayerChange(layer.id, { xPercent: clamp(layer.xPercent - 1) });
        break;
      case "ArrowRight":
        onLayerChange(layer.id, { xPercent: clamp(layer.xPercent + 1) });
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  };

  return (
    <div className="absolute inset-0 z-20 pointer-events-none">
      {/* Snap guides */}
      {guides.includes("h-center") && <GuideH topPct={50} />}
      {guides.includes("h-safe-top") && <GuideH topPct={5} />}
      {guides.includes("h-safe-bottom") && <GuideH topPct={95} />}
      {guides.includes("v-center") && <GuideV leftPct={50} />}
      {guides.includes("v-safe-l") && <GuideV leftPct={5} />}
      {guides.includes("v-safe-r") && <GuideV leftPct={95} />}
      {guides.includes("v-full") && (
        <>
          <GuideV leftPct={0} />
          <GuideV leftPct={100} />
        </>
      )}

      {/* One block per visible layer, in z-order (top layer's block on top) */}
      {[...layers]
        .filter((l) => l.visible)
        .sort((a, b) => a.zIndex - b.zIndex)
        .map((layer) => {
          const boxW = Math.max(12, (layer.widthPercent / 100) * frameWidth);
          const boxH = layerBoxHeight(layer, boxW, frameHeight, scale);
          const boxX = (layer.xPercent / 100) * frameWidth - boxW / 2;
          const boxY = (layer.yPercent / 100) * frameHeight - boxH / 2;
          const selected = layer.id === selectedLayerId;
          const active = layer.id === activeId;
          return (
            <div
              key={layer.id}
              role="group"
              aria-label={`${layer.name} layer. Drag to move; use the side handles to resize; arrow keys nudge by 1 percent.`}
              tabIndex={0}
              className={`absolute rounded border cursor-grab active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E11D48] ${
                active
                  ? "border-[#E11D48] bg-[#E11D48]/10"
                  : selected
                    ? "border-[#E11D48]/70 bg-[#E11D48]/5"
                    : "border-zinc-500/50 bg-zinc-500/5 hover:border-[#E11D48]/70"
              }`}
              style={{
                left: boxX,
                top: boxY,
                width: boxW,
                height: boxH,
                touchAction: "none",
                pointerEvents: "auto",
              }}
              onPointerDown={(e) => beginDrag(e, layer, "move")}
              onKeyDown={(e) => onKeyDown(e, layer)}
            >
              {selected && (
                <>
                  <div
                    aria-hidden
                    className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-2.5 h-7 rounded-full bg-[#E11D48] cursor-ew-resize hover:bg-rose-400"
                    style={{ touchAction: "none" }}
                    onPointerDown={(e) => beginDrag(e, layer, "resize-l")}
                  />
                  <div
                    aria-hidden
                    className="absolute -right-1.5 top-1/2 -translate-y-1/2 w-2.5 h-7 rounded-full bg-[#E11D48] cursor-ew-resize hover:bg-rose-400"
                    style={{ touchAction: "none" }}
                    onPointerDown={(e) => beginDrag(e, layer, "resize-r")}
                  />
                  <div
                    aria-hidden
                    className="absolute -bottom-1.5 -right-1.5 w-3 h-3 rounded-sm bg-[#E11D48] cursor-nwse-resize hover:bg-rose-400"
                    style={{ touchAction: "none" }}
                    onPointerDown={(e) => beginDrag(e, layer, "resize-r")}
                  />
                </>
              )}
            </div>
          );
        })}
    </div>
  );
}

// ─── Legacy single-block mode (flat layout params) ───────────────────────────

interface DragState {
  mode: "move" | "resize-l" | "resize-r";
  startX: number;
  startY: number;
  startPosY: number;
  startMarginX: number;
  startMaxW: number;
  startFontSize: number;
  startBoxW: number;
}

function LegacyDragBlock({
  frameWidth,
  frameHeight,
  canvasWidth,
  schema,
  params,
  family,
  onParamChange,
}: PreviewDragLayerProps) {
  const posField = fieldOf(schema, "positionYPercent");
  const marginField = fieldOf(schema, "marginX");
  const maxWidthField = fieldOf(schema, "maxWidthPercent");
  const fontSizeField = fieldOf(schema, "fontSize");

  const canMove = !!posField || !!marginField;
  const canResize = !!maxWidthField || !!fontSizeField;

  const [guides, setGuides] = useState<string[]>([]);
  const [active, setActive] = useState(false);
  const dragRef = useRef<DragState | null>(null);

  // Guard rail: hide the whole layer when the template exposes no layout params.
  if (!canMove && !canResize) return null;
  if (frameWidth <= 0 || frameHeight <= 0) return null;

  /** Composition px per CSS px (uniform — aspect ratio is preserved). */
  const scale = canvasWidth / frameWidth;

  const posY = clampToField(posField, num(params.positionYPercent, posField?.defaultValue ?? 50), 0, 100);
  const marginX = clampToField(marginField, num(params.marginX, marginField?.defaultValue ?? 48), 0, canvasWidth / 2);
  const maxW = num(params.maxWidthPercent, maxWidthField?.defaultValue ?? 90);
  const fontSize = num(params.fontSize, fontSizeField?.defaultValue ?? 44);
  const lineHeight = num(params.lineHeight, 1.25);
  const linesVisible = Math.min(3, Math.max(1, Math.round(num(params.linesVisible, 2))));
  const alignment = (params.alignment ?? "center") as string;

  // Mirror the composition layout: container is inset by marginX on both
  // sides; the block's vertical center sits at positionYPercent% of the frame.
  const containerLeft = marginX / scale;
  const containerW = Math.max(0, frameWidth - 2 * containerLeft);
  const boxW = (containerW * Math.min(100, Math.max(0, maxW))) / 100;
  // Height is an estimate (content-dependent) — the box is a manipulation
  // affordance, not a pixel-perfect outline.
  const estLines = family === "quote" ? 3 : linesVisible;
  const boxH = ((fontSize * lineHeight * estLines) / scale) * (family === "quote" ? 1.6 : 1.1);
  const boxX =
    alignment === "left"
      ? containerLeft
      : alignment === "right"
        ? containerLeft + containerW - boxW
        : containerLeft + (containerW - boxW) / 2;
  const boxY = (posY / 100) * frameHeight - boxH / 2;

  const handleMove = (clientX: number, clientY: number) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = clientX - d.startX;
    const dy = clientY - d.startY;
    const nextGuides: string[] = [];

    if (d.mode === "move") {
      if (posField) {
        let v = d.startPosY + (dy / frameHeight) * 100;
        v = clampToField(posField, v, 0, 100);
        for (const [target, key] of [
          [50, "h-center"],
          [5, "h-safe-top"],
          [95, "h-safe-bottom"],
        ] as const) {
          if (Math.abs(((v - target) / 100) * frameHeight) <= SNAP_PX) {
            v = target;
            nextGuides.push(key);
            break;
          }
        }
        onParamChange("positionYPercent", stepRound(posField, v));
      }
      if (marginField) {
        let m = d.startMarginX + dx * scale;
        m = clampToField(marginField, m, 0, canvasWidth / 2);
        const safe = canvasWidth * 0.05;
        if (Math.abs((m - safe) / scale) <= SNAP_PX) {
          m = safe;
          nextGuides.push("v-safe");
        }
        onParamChange("marginX", stepRound(marginField, m));
      }
    } else {
      const dir = d.mode === "resize-l" ? -1 : 1;
      // Center-aligned blocks grow symmetrically, so a handle drag of dx
      // changes the box width by 2·dx.
      const factor = alignment === "center" ? 2 : 1;
      if (maxWidthField) {
        const cw = Math.max(1, containerW);
        let w = d.startMaxW + ((dir * dx * factor) / cw) * 100;
        w = clampToField(maxWidthField, w, 10, 100);
        if (Math.abs(((w - 100) / 100) * cw) <= SNAP_PX) {
          w = 100;
          nextGuides.push("v-container");
        } else if (Math.abs(((w - 50) / 100) * cw) <= SNAP_PX) {
          w = 50;
          nextGuides.push("v-center");
        }
        onParamChange("maxWidthPercent", stepRound(maxWidthField, w));
      } else if (fontSizeField) {
        const base = Math.max(4, d.startBoxW);
        const ratio = Math.max(0.2, (base + dir * dx * factor) / base);
        onParamChange("fontSize", stepRound(fontSizeField, clampToField(fontSizeField, d.startFontSize * ratio, 8, 400)));
      }
    }
    setGuides(nextGuides);
  };

  const endDrag = () => {
    dragRef.current = null;
    setActive(false);
    setGuides([]);
  };

  const beginDrag = (e: React.PointerEvent, mode: DragState["mode"]) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      startPosY: posY,
      startMarginX: marginX,
      startMaxW: maxW,
      startFontSize: fontSize,
      startBoxW: boxW,
    };
    setActive(true);
    const onMove = (ev: PointerEvent) => handleMove(ev.clientX, ev.clientY);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      endDrag();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    let handled = true;
    // Arrow keys nudge by 1% (of frame height for Y, of canvas width for marginX).
    switch (e.key) {
      case "ArrowUp":
        if (posField) onParamChange("positionYPercent", stepRound(posField, clampToField(posField, posY - 1, 0, 100)));
        else handled = false;
        break;
      case "ArrowDown":
        if (posField) onParamChange("positionYPercent", stepRound(posField, clampToField(posField, posY + 1, 0, 100)));
        else handled = false;
        break;
      case "ArrowLeft":
        if (marginField)
          onParamChange("marginX", stepRound(marginField, clampToField(marginField, marginX - canvasWidth * 0.01, 0, canvasWidth / 2)));
        else handled = false;
        break;
      case "ArrowRight":
        if (marginField)
          onParamChange("marginX", stepRound(marginField, clampToField(marginField, marginX + canvasWidth * 0.01, 0, canvasWidth / 2)));
        else handled = false;
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  };

  const containerLeftPct = (containerLeft / frameWidth) * 100;

  return (
    <div className="absolute inset-0 z-20 pointer-events-none">
      {/* Snap guides */}
      {guides.includes("h-center") && <GuideH topPct={50} />}
      {guides.includes("h-safe-top") && <GuideH topPct={5} />}
      {guides.includes("h-safe-bottom") && <GuideH topPct={95} />}
      {guides.includes("v-center") && <GuideV leftPct={50} />}
      {guides.includes("v-safe") && (
        <>
          <GuideV leftPct={5} />
          <GuideV leftPct={95} />
        </>
      )}
      {guides.includes("v-container") && (
        <>
          <GuideV leftPct={containerLeftPct} />
          <GuideV leftPct={100 - containerLeftPct} />
        </>
      )}

      {/* Draggable block */}
      <div
        role="group"
        aria-label="Caption block position. Drag to move; use the side handles to resize; arrow keys nudge by 1 percent."
        tabIndex={0}
        className={`absolute rounded border cursor-grab active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E11D48] ${
          active ? "border-[#E11D48] bg-[#E11D48]/10" : "border-[#E11D48]/70 bg-[#E11D48]/5 hover:border-[#E11D48]"
        }`}
        style={{
          left: boxX,
          top: boxY,
          width: boxW,
          height: boxH,
          touchAction: "none",
          pointerEvents: "auto",
        }}
        onPointerDown={(e) => {
          if (canMove) beginDrag(e, "move");
        }}
        onKeyDown={onKeyDown}
      >
        {canResize && (
          <>
            <div
              aria-hidden
              className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-2.5 h-7 rounded-full bg-[#E11D48] cursor-ew-resize hover:bg-rose-400"
              style={{ touchAction: "none" }}
              onPointerDown={(e) => beginDrag(e, "resize-l")}
            />
            <div
              aria-hidden
              className="absolute -right-1.5 top-1/2 -translate-y-1/2 w-2.5 h-7 rounded-full bg-[#E11D48] cursor-ew-resize hover:bg-rose-400"
              style={{ touchAction: "none" }}
              onPointerDown={(e) => beginDrag(e, "resize-r")}
            />
            <div
              aria-hidden
              className="absolute -bottom-1.5 -right-1.5 w-3 h-3 rounded-sm bg-[#E11D48] cursor-nwse-resize hover:bg-rose-400"
              style={{ touchAction: "none" }}
              onPointerDown={(e) => beginDrag(e, "resize-r")}
            />
          </>
        )}
      </div>
    </div>
  );
}
