"use client";

import React, { useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { FONT_MANIFEST, nearestAvailableWeight } from "@/lib/fonts";
import type { StyleLayer } from "@/lib/style-lab/layers";

/**
 * Per-layer control panel: edits the selected StyleLayer via onChange(patch).
 *   text  — content (static) or binding note, font/weight/size/italic,
 *           colors, stroke, shadow, gradient, alignment, case, spacing
 *   image — upload (→ /api/style-lab/upload) + width
 *   shape — color/opacity/height/radius/gradient + width
 *   all   — position (x/y/width, two-way with the canvas drag layer),
 *           entry animation + easing + delay, loop animation
 */

interface FontInfo {
  family: string;
  weights: number[];
  italics: number[];
}

export interface LayerEditorProps {
  layer: StyleLayer;
  fonts: FontInfo[];
  onChange: (patch: Partial<StyleLayer>) => void;
}

const inputCls =
  "w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-100 focus:outline-none focus:border-zinc-600 text-[11px]";

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="font-medium text-zinc-300 block">{label}</label>
      <div className="flex items-center gap-2.5">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="flex-1 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-[#E11D48]"
        />
        <span className="font-mono text-[#E11D48] text-[10px] w-10 text-right">{value}</span>
      </div>
    </div>
  );
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="font-medium text-zinc-300 block">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="w-8 h-8 rounded border border-zinc-800 cursor-pointer bg-transparent"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputCls} flex-1 font-mono`}
        />
      </div>
    </div>
  );
}

function SelectRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="font-medium text-zinc-300 block">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <label className="font-medium text-zinc-300">{label}</label>
      <label className="relative inline-flex items-center cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only peer"
        />
        <div className="w-9 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-300 after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#E11D48]"></div>
      </label>
    </div>
  );
}

export function LayerEditor({ layer, fonts, onChange }: LayerEditorProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const fontList = fonts.length > 0 ? fonts : FONT_MANIFEST;
  const fontInfo = fontList.find((f) => f.family === layer.fontFamily) ?? null;

  const handleFontChange = (familyName: string) => {
    const snapped = nearestAvailableWeight(familyName, Number(layer.fontWeight ?? 400)) ?? 400;
    onChange({ fontFamily: familyName, fontWeight: snapped });
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/style-lab/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      onChange({ imageUrl: data.url });
      toast.success("Image uploaded");
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4 text-xs">
      {/* Name */}
      <div className="space-y-1.5">
        <label className="font-medium text-zinc-300 block">Layer Name</label>
        <input
          type="text"
          value={layer.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className={inputCls}
        />
      </div>

      {/* ── Text layer ── */}
      {layer.type === "text" && (
        <>
          {layer.bind ? (
            <p className="text-[10px] text-zinc-500 leading-normal border border-zinc-800 rounded p-2 bg-zinc-950">
              Bound to {layer.bind === "lyrics" ? "the item's lyric lines (karaoke engine)" : "the quote text"}
              — content comes from the rendered item, not this layer.
            </p>
          ) : (
            <div className="space-y-1.5">
              <label className="font-medium text-zinc-300 block">Content</label>
              <textarea
                rows={2}
                value={layer.text ?? ""}
                onChange={(e) => onChange({ text: e.target.value })}
                className={`${inputCls} resize-y`}
              />
            </div>
          )}

          <SelectRow
            label="Font Family"
            value={layer.fontFamily ?? "Inter"}
            options={fontList.map((f) => ({ value: f.family, label: f.family }))}
            onChange={handleFontChange}
          />

          <div className="space-y-1.5">
            <label className="font-medium text-zinc-300 block">Font Weight</label>
            <select
              value={layer.fontWeight ?? 700}
              onChange={(e) => onChange({ fontWeight: Number(e.target.value) })}
              className={inputCls}
            >
              {(fontInfo?.weights ?? [100, 200, 300, 400, 500, 600, 700, 800, 900]).map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </div>

          <SliderRow
            label="Font Size (px)"
            value={layer.fontSize ?? 44}
            min={12}
            max={160}
            step={1}
            onChange={(v) => onChange({ fontSize: v })}
          />

          <ToggleRow label="Italic" checked={layer.italic === true} onChange={(v) => onChange({ italic: v })} />

          <ColorRow label="Text Color" value={layer.textColor ?? "#FFFFFF"} onChange={(v) => onChange({ textColor: v })} />
          <ColorRow
            label="Highlight Color (karaoke)"
            value={layer.highlightColor ?? "#E11D48"}
            onChange={(v) => onChange({ highlightColor: v })}
          />

          <SliderRow
            label="Stroke Width (px)"
            value={layer.outlineWidth ?? 0}
            min={0}
            max={12}
            step={0.5}
            onChange={(v) => onChange({ outlineWidth: v })}
          />
          {(layer.outlineWidth ?? 0) > 0 && (
            <ColorRow
              label="Stroke Color"
              value={layer.outlineColor ?? "#000000"}
              onChange={(v) => onChange({ outlineColor: v })}
            />
          )}

          <ToggleRow label="Shadow" checked={layer.shadow === true} onChange={(v) => onChange({ shadow: v })} />
          {layer.shadow === true && (
            <SliderRow
              label="Shadow Intensity"
              value={layer.shadowIntensity ?? 0.4}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => onChange({ shadowIntensity: v })}
            />
          )}

          <ColorRow
            label="Gradient To (empty = off)"
            value={layer.textGradientTo ?? ""}
            onChange={(v) => onChange({ textGradientTo: v || undefined })}
          />

          <SelectRow
            label="Alignment"
            value={layer.alignment ?? "center"}
            options={[
              { value: "left", label: "Left" },
              { value: "center", label: "Center" },
              { value: "right", label: "Right" },
            ]}
            onChange={(v) => onChange({ alignment: v })}
          />
          <SelectRow
            label="Text Case"
            value={layer.textTransform ?? "none"}
            options={[
              { value: "none", label: "None" },
              { value: "uppercase", label: "Uppercase" },
              { value: "lowercase", label: "Lowercase" },
            ]}
            onChange={(v) => onChange({ textTransform: v })}
          />
          <SliderRow
            label="Letter Spacing (px)"
            value={layer.letterSpacing ?? 0}
            min={-4}
            max={20}
            step={0.5}
            onChange={(v) => onChange({ letterSpacing: v })}
          />
          <SliderRow
            label="Line Height"
            value={layer.lineHeight ?? 1.25}
            min={1}
            max={2.5}
            step={0.05}
            onChange={(v) => onChange({ lineHeight: v })}
          />
        </>
      )}

      {/* ── Image layer ── */}
      {layer.type === "image" && (
        <div className="space-y-2">
          <label className="font-medium text-zinc-300 block">Image</label>
          {layer.imageUrl ? (
            <div className="border border-zinc-800 rounded bg-zinc-950 p-2 flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={layer.imageUrl} alt={layer.name} className="h-10 w-10 object-contain rounded" />
              <span className="flex-1 min-w-0 truncate font-mono text-[9px] text-zinc-500">
                {layer.imageUrl}
              </span>
            </div>
          ) : (
            <p className="text-[10px] text-zinc-600">No image yet — upload a logo or PNG.</p>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-full flex items-center justify-center gap-1.5 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-200 py-1.5 rounded transition text-[11px] font-semibold disabled:opacity-50"
          >
            {uploading ? <Loader2 size={12} className="animate-spin text-[#E11D48]" /> : <Upload size={12} />}
            {layer.imageUrl ? "Replace Image" : "Upload Image"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            tabIndex={-1}
            aria-hidden
            onChange={handleUpload}
          />
        </div>
      )}

      {/* ── Shape layer ── */}
      {layer.type === "shape" && (
        <>
          <ColorRow
            label="Shape Color"
            value={layer.shapeColor ?? "#000000"}
            onChange={(v) => onChange({ shapeColor: v })}
          />
          <SliderRow
            label="Opacity"
            value={layer.shapeOpacity ?? 0.6}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => onChange({ shapeOpacity: v })}
          />
          <SliderRow
            label="Height (% of canvas)"
            value={layer.heightPercent ?? 12}
            min={1}
            max={100}
            step={1}
            onChange={(v) => onChange({ heightPercent: v })}
          />
          <SliderRow
            label="Corner Radius (px)"
            value={layer.borderRadius ?? 0}
            min={0}
            max={120}
            step={1}
            onChange={(v) => onChange({ borderRadius: v })}
          />
          <ColorRow
            label="Gradient To (empty = off)"
            value={layer.shapeGradientTo ?? ""}
            onChange={(v) => onChange({ shapeGradientTo: v || undefined })}
          />
          {layer.shapeGradientTo && (
            <SliderRow
              label="Gradient Angle (°)"
              value={layer.shapeGradientDeg ?? 180}
              min={0}
              max={360}
              step={5}
              onChange={(v) => onChange({ shapeGradientDeg: v })}
            />
          )}
        </>
      )}

      {/* ── Transform (shared; two-way with the canvas drag layer) ── */}
      <div className="space-y-3.5 border-t border-zinc-900 pt-3.5">
        <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Position</h4>
        <SliderRow
          label="X Center (%)"
          value={layer.xPercent}
          min={0}
          max={100}
          step={0.5}
          onChange={(v) => onChange({ xPercent: v })}
        />
        <SliderRow
          label="Y Center (%)"
          value={layer.yPercent}
          min={0}
          max={100}
          step={0.5}
          onChange={(v) => onChange({ yPercent: v })}
        />
        <SliderRow
          label="Width (% of canvas)"
          value={layer.widthPercent}
          min={2}
          max={100}
          step={1}
          onChange={(v) => onChange({ widthPercent: v })}
        />
      </div>

      {/* ── Entry animation (shared) ── */}
      <div className="space-y-3.5 border-t border-zinc-900 pt-3.5">
        <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Entry Animation</h4>
        <SelectRow
          label="Type"
          value={layer.entryType ?? "fade"}
          options={[
            { value: "fade", label: "Fade" },
            { value: "slide-up", label: "Slide Up" },
            { value: "pop", label: "Pop" },
            { value: "none", label: "None" },
          ]}
          onChange={(v) => onChange({ entryType: v })}
        />
        <SelectRow
          label="Easing"
          value={layer.easing ?? "ease-out"}
          options={[
            { value: "ease-out", label: "Ease Out" },
            { value: "spring", label: "Spring" },
            { value: "ease-in-out", label: "Ease In-Out" },
            { value: "linear", label: "Linear" },
          ]}
          onChange={(v) => onChange({ easing: v })}
        />
        <SliderRow
          label="Duration (ms)"
          value={layer.entryDurationMs ?? 300}
          min={0}
          max={2000}
          step={50}
          onChange={(v) => onChange({ entryDurationMs: v })}
        />
        <SliderRow
          label="Delay (ms)"
          value={layer.delayMs ?? 0}
          min={0}
          max={5000}
          step={50}
          onChange={(v) => onChange({ delayMs: v })}
        />
      </div>

      {/* ── Loop animation (shared; continuous, post-entry) ── */}
      <div className="space-y-3.5 border-t border-zinc-900 pt-3.5">
        <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Loop Animation</h4>
        <SelectRow
          label="Loop"
          value={layer.loopType ?? "none"}
          options={[
            { value: "none", label: "None" },
            { value: "pulse", label: "Pulse (subtle scale)" },
            { value: "float", label: "Float (gentle drift)" },
          ]}
          onChange={(v) => onChange({ loopType: v })}
        />
        {(layer.loopType ?? "none") !== "none" && (
          <SliderRow
            label="Loop Duration (ms)"
            value={layer.loopDurationMs ?? 2000}
            min={400}
            max={6000}
            step={100}
            onChange={(v) => onChange({ loopDurationMs: v })}
          />
        )}
      </div>
    </div>
  );
}
