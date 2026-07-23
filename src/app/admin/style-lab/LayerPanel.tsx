"use client";

import React from "react";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Layers,
  Plus,
  Square,
  Trash2,
  Type,
} from "lucide-react";
import { LEGACY_MAIN_LAYER_ID, type LayerType, type StyleLayer } from "@/lib/style-lab/layers";

/**
 * Style Lab layer panel: the z-ordered stack of a style (top of list =
 * rendered on top). Row actions: select, show/hide, reorder, duplicate,
 * delete. The add buttons create text / image / shape layers.
 *
 * In legacy (single-layer) mode the panel shows the synthesized main text
 * layer only — it cannot be removed or reordered; adding any layer
 * materializes the stack (handled by the parent via onAdd).
 */

export interface LayerPanelProps {
  /** Effective stack, bottom → top (zIndex order). */
  layers: StyleLayer[];
  layeredMode: boolean;
  selectedLayerId: string;
  onSelect: (id: string) => void;
  onAdd: (type: LayerType) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onToggleVisible: (id: string) => void;
}

const TYPE_ICON: Record<LayerType, React.ReactNode> = {
  text: <Type size={12} />,
  image: <ImageIcon size={12} />,
  shape: <Square size={12} />,
};

const iconBtn =
  "p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-zinc-500";

export function LayerPanel({
  layers,
  layeredMode,
  selectedLayerId,
  onSelect,
  onAdd,
  onRemove,
  onDuplicate,
  onMove,
  onToggleVisible,
}: LayerPanelProps) {
  // Display top-most layer first.
  const ordered = [...layers].sort((a, b) => b.zIndex - a.zIndex);

  return (
    <div className="border border-zinc-800 rounded-md bg-[#09090b] p-4 space-y-3">
      <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
        <Layers size={13} className="text-[#E11D48]" />
        1. Layers
        <span className="ml-auto flex items-center gap-1 normal-case">
          <button
            onClick={() => onAdd("text")}
            title="Add text layer"
            className="flex items-center gap-1 px-2 py-1 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 rounded transition text-[10px] font-semibold"
          >
            <Type size={11} />
            <Plus size={9} />
          </button>
          <button
            onClick={() => onAdd("image")}
            title="Add image layer"
            className="flex items-center gap-1 px-2 py-1 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 rounded transition text-[10px] font-semibold"
          >
            <ImageIcon size={11} />
            <Plus size={9} />
          </button>
          <button
            onClick={() => onAdd("shape")}
            title="Add shape strip layer"
            className="flex items-center gap-1 px-2 py-1 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 rounded transition text-[10px] font-semibold"
          >
            <Square size={11} />
            <Plus size={9} />
          </button>
        </span>
      </h3>

      <div className="space-y-1">
        {ordered.map((layer) => {
          const isMain = layer.id === LEGACY_MAIN_LAYER_ID;
          const locked = !layeredMode && isMain;
          const selected = layer.id === selectedLayerId;
          const idx = layers.findIndex((l) => l.id === layer.id);
          return (
            <div
              key={layer.id}
              onClick={() => onSelect(layer.id)}
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded border cursor-pointer transition ${
                selected
                  ? "border-[#E11D48]/60 bg-[#E11D48]/10"
                  : "border-zinc-800 bg-zinc-950 hover:border-zinc-700"
              }`}
            >
              <span className="text-zinc-500 shrink-0">{TYPE_ICON[layer.type]}</span>
              <span
                className={`flex-1 min-w-0 truncate text-[11px] font-semibold ${
                  layer.visible ? "text-zinc-200" : "text-zinc-600 line-through"
                }`}
              >
                {layer.name}
                {layer.bind === "lyrics" && (
                  <span className="ml-1.5 text-[9px] font-mono text-zinc-500 uppercase">lyrics</span>
                )}
                {layer.bind === "quote" && (
                  <span className="ml-1.5 text-[9px] font-mono text-zinc-500 uppercase">quote</span>
                )}
              </span>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleVisible(layer.id);
                }}
                disabled={locked}
                title={layer.visible ? "Hide layer" : "Show layer"}
                aria-label={`${layer.visible ? "Hide" : "Show"} ${layer.name}`}
                className={iconBtn}
              >
                {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onMove(layer.id, 1);
                }}
                disabled={locked || idx >= layers.length - 1}
                title="Move up (render on top)"
                aria-label={`Move ${layer.name} up`}
                className={iconBtn}
              >
                <ChevronUp size={12} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onMove(layer.id, -1);
                }}
                disabled={locked || idx <= 0}
                title="Move down"
                aria-label={`Move ${layer.name} down`}
                className={iconBtn}
              >
                <ChevronDown size={12} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDuplicate(layer.id);
                }}
                disabled={locked}
                title="Duplicate layer"
                aria-label={`Duplicate ${layer.name}`}
                className={iconBtn}
              >
                <Copy size={12} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(layer.id);
                }}
                disabled={locked || layers.length <= 1}
                title="Delete layer"
                aria-label={`Delete ${layer.name}`}
                className={`${iconBtn} hover:text-red-400`}
              >
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}
      </div>

      {!layeredMode && (
        <p className="text-[10px] text-zinc-600 leading-normal">
          Single-layer style — the main text binds to the template params. Add a layer to build a
          full stack (attribution, logo, shape strip).
        </p>
      )}
    </div>
  );
}
