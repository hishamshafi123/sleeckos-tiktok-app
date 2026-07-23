"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Copy, Film, FlaskConical, Image as ImageIcon, Layers, Library, Loader2,
  Pencil, RefreshCw, Save, Search, Sliders, Sparkles, Trash2, ExternalLink,
} from "lucide-react";
import { toast } from "sonner";

import { FONT_MANIFEST, nearestAvailableWeight } from "@/lib/fonts";
import {
  defaultParams,
  type ParamField,
  type StyleFamily,
  type StyleParams,
} from "@/lib/style-lab/schema";
import { StylePreviewPanel } from "./StylePreviewPanel";

interface StyleLabClientProps {
  user: { id: string; role: string };
}

interface FontInfo {
  family: string;
  weights: number[];
  italics: number[];
}

// ─── Browser font loading (same TTFs the renderer uses — deterministic preview) ─

function useBundledFonts(): boolean {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const loaders: Promise<unknown>[] = [];
    for (const entry of FONT_MANIFEST) {
      for (const w of entry.weights) {
        const face = new FontFace(entry.family, `url('/${entry.fileFor(w)}') format('truetype')`, {
          weight: String(w),
          style: "normal",
        });
        loaders.push(face.load().then((f) => document.fonts.add(f)));
      }
      for (const w of entry.italics) {
        const face = new FontFace(entry.family, `url('/${entry.fileFor(w, true)}') format('truetype')`, {
          weight: String(w),
          style: "italic",
        });
        loaders.push(face.load().then((f) => document.fonts.add(f)));
      }
    }
    Promise.allSettled(loaders).then(() => {
      if (!cancelled) setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return loaded;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function StyleLabClient({ user }: StyleLabClientProps) {
  const fontsLoaded = useBundledFonts();

  const [view, setView] = useState<"editor" | "library">("editor");
  const [templates, setTemplates] = useState<any[]>([]);
  const [fonts, setFonts] = useState<FontInfo[]>([]);
  const [savedStyles, setSavedStyles] = useState<any[]>([]);

  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string>("lyric-caption");
  const [params, setParams] = useState<StyleParams>({});
  const [selectedStyleId, setSelectedStyleId] = useState<string>("");
  const [styleName, setStyleName] = useState<string>("");
  const [tagsInput, setTagsInput] = useState<string>("");

  const [familyFilter, setFamilyFilter] = useState<"all" | StyleFamily>("all");
  const [search, setSearch] = useState<string>("");

  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [loadingStyles, setLoadingStyles] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [renderBusy, setRenderBusy] = useState<"video" | "still" | null>(null);
  const [renderResult, setRenderResult] = useState<{ type: "video" | "still"; url: string } | null>(null);
  const [renderError, setRenderError] = useState<string>("");

  const [aiDesc, setAiDesc] = useState<string>("");
  const [aiFamily, setAiFamily] = useState<StyleFamily>("lyric");
  const [aiBusy, setAiBusy] = useState(false);

  const [renamingId, setRenamingId] = useState<string>("");
  const [renameValue, setRenameValue] = useState<string>("");

  const pollTimersRef = useRef<NodeJS.Timeout[]>([]);

  // ─── Data loading ──────────────────────────────────────────────────────────

  const fetchTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    try {
      const res = await fetch("/api/style-lab/templates");
      if (!res.ok) throw new Error("Failed to load templates");
      const data = await res.json();
      setTemplates(data);
      if (data.length > 0) {
        const tpl = data.find((t: any) => t.key === "lyric-caption") ?? data[0];
        initFromTemplate(tpl);
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to load templates");
    } finally {
      setLoadingTemplates(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchFonts = useCallback(async () => {
    try {
      const res = await fetch("/api/style-lab/fonts");
      if (!res.ok) throw new Error("Failed to load fonts");
      setFonts(await res.json());
    } catch (err) {
      console.error(err);
      // Fall back to the bundled manifest — identical data.
      setFonts(FONT_MANIFEST.map((f) => ({ family: f.family, weights: f.weights, italics: f.italics })));
    }
  }, []);

  const fetchSavedStyles = useCallback(async () => {
    try {
      const res = await fetch("/api/style-lab/saved-styles");
      if (!res.ok) throw new Error("Failed to load saved styles");
      setSavedStyles(await res.json());
    } catch (err) {
      console.error(err);
      toast.error("Failed to load saved styles");
    } finally {
      setLoadingStyles(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
    fetchFonts();
    fetchSavedStyles();
    const timers = pollTimersRef.current;
    return () => timers.forEach((t) => clearTimeout(t));
  }, [fetchTemplates, fetchFonts, fetchSavedStyles]);

  /** Thumbnails render in the background — refresh the library a few times after a mutation. */
  const scheduleLibraryRefresh = () => {
    for (const delay of [15000, 45000]) {
      pollTimersRef.current.push(setTimeout(() => fetchSavedStyles(), delay));
    }
  };

  // ─── Schema / params ───────────────────────────────────────────────────────

  const schemaOf = useCallback(
    (templateKey: string): ParamField[] => {
      const tpl = templates.find((t) => t.key === templateKey);
      if (!tpl) return [];
      try {
        return JSON.parse(tpl.paramSchema || "[]");
      } catch {
        return [];
      }
    },
    [templates]
  );

  const schema = useMemo(() => schemaOf(selectedTemplateKey), [schemaOf, selectedTemplateKey]);
  const family: StyleFamily = selectedTemplateKey === "quote-card" ? "quote" : "lyric";

  function initFromTemplate(tpl: any) {
    setSelectedTemplateKey(tpl.key);
    try {
      const fields: ParamField[] = JSON.parse(tpl.paramSchema || "[]");
      setParams(defaultParams(fields));
    } catch {
      setParams({});
    }
  }

  const handleSelectTemplate = (tpl: any) => {
    initFromTemplate(tpl);
    setSelectedStyleId("");
    setStyleName("");
    setTagsInput("");
    setRenderResult(null);
    setRenderError("");
  };

  const handleParamChange = (key: string, value: any) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  };

  const handleFontChange = (familyName: string) => {
    setParams((prev) => {
      const snapped = nearestAvailableWeight(familyName, Number(prev.fontWeight ?? 400)) ?? 400;
      return { ...prev, fontFamily: familyName, fontWeight: snapped };
    });
  };

  const handleLoadStyle = (style: any) => {
    setSelectedStyleId(style.id);
    setSelectedTemplateKey(style.templateKey);
    setStyleName(style.name);
    setTagsInput(Array.isArray(style.tags) ? style.tags.join(", ") : "");
    setParams(typeof style.params === "object" ? style.params : {});
    setRenderResult(null);
    setRenderError("");
    setView("editor");
    toast.success(`Loaded "${style.name}" into the editor`);
  };

  const handleResetToDefaults = () => {
    setParams(defaultParams(schema));
    setSelectedStyleId("");
    setStyleName("");
    setTagsInput("");
  };

  // ─── Persistence ───────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!styleName.trim()) {
      toast.error("Style name is required");
      return;
    }
    setIsSaving(true);
    const tags = tagsInput.split(",").map((t) => t.trim()).filter(Boolean);
    try {
      let res: Response;
      if (selectedStyleId) {
        res = await fetch(`/api/style-lab/saved-styles/${selectedStyleId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: styleName.trim(), params, tags }),
        });
      } else {
        res = await fetch("/api/style-lab/saved-styles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ templateKey: selectedTemplateKey, name: styleName.trim(), params, tags }),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save style");
      toast.success(selectedStyleId ? "Style updated" : "Style saved — thumbnail rendering in background");
      if (!selectedStyleId) setSelectedStyleId(data.id);
      fetchSavedStyles();
      scheduleLibraryRefresh();
    } catch (err: any) {
      toast.error(err.message || "Failed to save style");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDuplicate = async (id: string) => {
    try {
      const res = await fetch(`/api/style-lab/saved-styles/${id}/duplicate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to duplicate");
      toast.success(`Duplicated as "${data.name}"`);
      fetchSavedStyles();
    } catch (err: any) {
      toast.error(err.message || "Failed to duplicate style");
    }
  };

  const handleDelete = async (style: any) => {
    const ok = window.confirm(
      `Delete "${style.name}"?\n\nHeads up: if this style is referenced by batches or track templates, those keep their copied params but lose the style link.`
    );
    if (!ok) return;
    try {
      const res = await fetch(`/api/style-lab/saved-styles/${style.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete");
      }
      toast.success("Style deleted");
      if (selectedStyleId === style.id) {
        setSelectedStyleId("");
        setStyleName("");
        setTagsInput("");
      }
      fetchSavedStyles();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete style");
    }
  };

  const handleRename = async (id: string) => {
    if (renamingId !== id) return; // already committed (Enter fires before blur)
    const name = renameValue.trim();
    setRenamingId("");
    if (!name) return;
    try {
      const res = await fetch(`/api/style-lab/saved-styles/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to rename");
      toast.success("Style renamed");
      if (selectedStyleId === id) setStyleName(name);
      fetchSavedStyles();
    } catch (err: any) {
      toast.error(err.message || "Failed to rename style");
    }
  };

  // ─── Test render ───────────────────────────────────────────────────────────

  const handleRenderTest = async (format: "video" | "still") => {
    setRenderBusy(format);
    setRenderResult(null);
    setRenderError("");
    try {
      const res = await fetch("/api/style-lab/render-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateKey: selectedTemplateKey, params, format }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Test render failed");
      setRenderResult({ type: format, url: data.url });
      toast.success(format === "still" ? "Still rendered" : "Test clip rendered");
    } catch (err: any) {
      setRenderError(err.message || "Test render failed");
      toast.error(err.message || "Test render failed");
    } finally {
      setRenderBusy(null);
    }
  };

  // ─── AI variant ────────────────────────────────────────────────────────────

  const handleGenerateAiVariant = async () => {
    if (!aiDesc.trim()) {
      toast.error("Describe the style you want first");
      return;
    }
    setAiBusy(true);
    try {
      const res = await fetch("/api/style-lab/ai-variant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: aiDesc.trim(), family: aiFamily }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AI variant failed");
      toast.success(`AI variant "${data.name}" created — thumbnail rendering in background`);
      setAiDesc("");
      fetchSavedStyles();
      scheduleLibraryRefresh();
    } catch (err: any) {
      toast.error(err.message || "AI variant failed");
    } finally {
      setAiBusy(false);
    }
  };

  // ─── Derived view data ─────────────────────────────────────────────────────

  const groups = useMemo(() => {
    const out: { name: string; fields: ParamField[] }[] = [];
    for (const f of schema) {
      const g = out.find((x) => x.name === f.group);
      if (g) g.fields.push(f);
      else out.push({ name: f.group, fields: [f] });
    }
    return out;
  }, [schema]);

  const fontInfo = useMemo(() => {
    const list = fonts.length > 0 ? fonts : FONT_MANIFEST;
    return list.find((f) => f.family === params.fontFamily) ?? null;
  }, [fonts, params.fontFamily]);

  const filteredStyles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return savedStyles.filter((s) => {
      if (familyFilter !== "all" && s.family !== familyFilter) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        (Array.isArray(s.tags) && s.tags.some((t: string) => t.toLowerCase().includes(q)))
      );
    });
  }, [savedStyles, familyFilter, search]);

  // ─── Control renderers ─────────────────────────────────────────────────────

  const renderField = (field: ParamField) => {
    const value = params[field.key] !== undefined ? params[field.key] : field.defaultValue;

    switch (field.type) {
      case "font":
        return (
          <select
            value={value}
            onChange={(e) => handleFontChange(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-100 focus:outline-none focus:border-zinc-600 text-[11px]"
          >
            {(fonts.length > 0 ? fonts : FONT_MANIFEST).map((f) => (
              <option key={f.family} value={f.family}>
                {f.family}
              </option>
            ))}
          </select>
        );

      case "weight": {
        const weights = fontInfo?.weights ?? [100, 200, 300, 400, 500, 600, 700, 800, 900];
        const effective = weights.includes(Number(value))
          ? Number(value)
          : (nearestAvailableWeight(params.fontFamily ?? "Inter", Number(value)) ?? 400);
        return (
          <div className="space-y-1">
            <select
              value={effective}
              onChange={(e) => handleParamChange(field.key, Number(e.target.value))}
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-100 focus:outline-none focus:border-zinc-600 text-[11px]"
            >
              {weights.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
            {params.italic && fontInfo && fontInfo.italics.length === 0 && (
              <p className="text-[10px] text-zinc-600">This family ships no italic files — the browser will synthesize italics.</p>
            )}
          </div>
        );
      }

      case "enum":
        return (
          <select
            value={value}
            onChange={(e) => handleParamChange(field.key, e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-100 focus:outline-none focus:border-zinc-600 text-[11px]"
          >
            {(field.options ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        );

      case "color":
        return (
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label={`${field.label} picker`}
              value={/^#[0-9a-fA-F]{6}$/.test(String(value)) ? value : "#000000"}
              onChange={(e) => handleParamChange(field.key, e.target.value)}
              className="w-8 h-8 rounded border border-zinc-800 cursor-pointer bg-transparent"
            />
            <input
              type="text"
              value={String(value)}
              onChange={(e) => handleParamChange(field.key, e.target.value)}
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-100 focus:outline-none focus:border-zinc-600 font-mono text-[11px]"
            />
          </div>
        );

      case "boolean":
        return (
          <label className="relative inline-flex items-center cursor-pointer mt-1">
            <input
              type="checkbox"
              checked={!!value}
              onChange={(e) => handleParamChange(field.key, e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-300 after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#E11D48]"></div>
          </label>
        );

      case "number":
      default:
        return (
          <div className="flex items-center gap-2.5">
            <input
              type="range"
              min={field.min ?? 0}
              max={field.max ?? 100}
              step={field.step ?? 1}
              value={Number(value)}
              onChange={(e) => handleParamChange(field.key, parseFloat(e.target.value))}
              className="flex-1 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-[#E11D48]"
            />
            <span className="font-mono text-[#E11D48] text-[10px] w-10 text-right">{Number(value)}</span>
          </div>
        );
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 text-zinc-100 bg-[#09090b]">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-zinc-800 pb-5 gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <FlaskConical size={18} className="text-[#E11D48]" />
            <h1 className="text-lg font-bold tracking-tight">Style Lab</h1>
          </div>
          <p className="text-xs text-zinc-500">
            Param-driven caption styles on the bundled font system. Tune live in the player, save presets, or let AI draft a variant.
          </p>
        </div>

        <div className="flex bg-zinc-950 border border-zinc-800 rounded p-0.5 text-[11px] font-semibold text-zinc-400 self-start">
          <button
            onClick={() => setView("editor")}
            className={`px-3 py-1 rounded transition flex items-center gap-1.5 ${view === "editor" ? "bg-zinc-800 text-zinc-100" : "hover:text-zinc-200"}`}
          >
            <Sliders size={12} />
            Editor
          </button>
          <button
            onClick={() => setView("library")}
            className={`px-3 py-1 rounded transition flex items-center gap-1.5 ${view === "library" ? "bg-zinc-800 text-zinc-100" : "hover:text-zinc-200"}`}
          >
            <Library size={12} />
            Library ({savedStyles.length})
          </button>
        </div>
      </div>

      {view === "editor" ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: template picker + control panel */}
          <div className="lg:col-span-4 space-y-5">
            <div className="border border-zinc-800 rounded-md bg-[#09090b] p-4 space-y-3.5">
              <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">1. Base Template</h3>
              {loadingTemplates ? (
                <div className="flex items-center justify-center py-6 text-xs text-zinc-600 gap-1.5">
                  <Loader2 size={12} className="animate-spin text-zinc-500" />
                  Loading templates...
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {templates.map((tpl) => {
                    const isSelected = selectedTemplateKey === tpl.key;
                    return (
                      <button
                        key={tpl.key}
                        onClick={() => handleSelectTemplate(tpl)}
                        className={`text-left p-3 rounded-lg border text-xs transition flex flex-col gap-1 ${
                          isSelected
                            ? "bg-[#E11D48]/10 border-[#E11D48]/40 text-zinc-100"
                            : "bg-[#0c0c0f]/40 border-zinc-800/80 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                        }`}
                      >
                        <span className="font-semibold text-zinc-200">{tpl.name}</span>
                        <span className="text-[10px] text-zinc-600 font-mono uppercase">
                          {tpl.key === "quote-card" ? "Quote family" : "Lyric family"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="border border-zinc-800 rounded-md bg-[#09090b] p-4 space-y-5">
              <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                <Sliders size={13} className="text-[#E11D48]" />
                2. Parameters
              </h3>

              {groups.length === 0 ? (
                <p className="text-[11px] text-zinc-500 italic">No parameter schema on this template.</p>
              ) : (
                groups.map((group) => (
                  <div key={group.name} className="space-y-3">
                    <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest border-b border-zinc-900 pb-1">
                      {group.name}
                    </h4>
                    <div className="space-y-3.5 text-xs">
                      {group.fields.map((field) => (
                        <div key={field.key} className="space-y-1.5">
                          <label className="font-medium text-zinc-300 block">{field.label}</label>
                          {renderField(field)}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Middle: live preview (dockable / floating) */}
          <div className="lg:col-span-4 space-y-5">
            <StylePreviewPanel
              templateKey={selectedTemplateKey}
              family={family}
              schema={schema}
              params={params}
              onParamChange={handleParamChange}
              fontsLoaded={fontsLoaded}
              renderBusy={renderBusy}
              onRenderTest={handleRenderTest}
            />
          </div>

          {/* Right: save + test render */}
          <div className="lg:col-span-4 space-y-5">
            <div className="border border-zinc-800 rounded-md bg-[#09090b] p-4 space-y-4">
              <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                <Save size={13} className="text-[#E11D48]" />
                {selectedStyleId ? "4. Update Style" : "4. Save Style"}
              </h3>

              <div className="space-y-3.5 text-xs">
                <div className="space-y-1.5">
                  <label className="font-medium text-zinc-400">Style Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Neon Karaoke"
                    value={styleName}
                    onChange={(e) => setStyleName(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-100 focus:outline-none focus:border-zinc-600 font-semibold"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="font-medium text-zinc-400">Tags (comma-separated)</label>
                  <input
                    type="text"
                    placeholder="e.g. music, minimal"
                    value={tagsInput}
                    onChange={(e) => setTagsInput(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-100 focus:outline-none focus:border-zinc-600 font-mono text-[11px]"
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex-1 flex items-center justify-center gap-1.5 bg-[#E11D48] hover:bg-rose-700 text-white font-bold py-2 rounded transition text-[11px] disabled:opacity-50"
                  >
                    {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                    {selectedStyleId ? "Update Style" : "Save Style"}
                  </button>
                  <button
                    onClick={handleResetToDefaults}
                    className="px-3 flex items-center justify-center gap-1.5 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 py-2 rounded transition text-[11px] font-semibold"
                    title="Reset to template defaults"
                  >
                    <RefreshCw size={12} />
                    Reset
                  </button>
                </div>
                {selectedStyleId && (
                  <p className="text-[10px] text-zinc-600">
                    Editing saved style <span className="font-mono text-zinc-500">{selectedStyleId.substring(0, 8)}</span>. Reset to start a new one.
                  </p>
                )}
              </div>
            </div>

            <div className="border border-zinc-800 rounded-md bg-[#09090b] p-4 space-y-4">
              <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles size={13} className="text-[#E11D48]" />
                5. Test Render
              </h3>

              <div className="space-y-3.5 text-xs">
                <p className="text-[10px] text-zinc-500 leading-normal">
                  Server-renders a ~3s clip or a still frame with the current params into <span className="font-mono">public/uploads/style-lab/</span>. One render at a time.
                </p>

                <div className="flex gap-2">
                  <button
                    onClick={() => handleRenderTest("video")}
                    disabled={renderBusy !== null}
                    className="flex-1 flex items-center justify-center gap-1.5 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-200 py-2 rounded transition text-[11px] disabled:opacity-50 font-semibold"
                  >
                    {renderBusy === "video" ? <Loader2 size={12} className="animate-spin text-[#E11D48]" /> : <Film size={12} />}
                    Render Clip
                  </button>
                  <button
                    onClick={() => handleRenderTest("still")}
                    disabled={renderBusy !== null}
                    className="flex-1 flex items-center justify-center gap-1.5 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-200 py-2 rounded transition text-[11px] disabled:opacity-50 font-semibold"
                  >
                    {renderBusy === "still" ? <Loader2 size={12} className="animate-spin text-[#E11D48]" /> : <ImageIcon size={12} />}
                    Render Still
                  </button>
                </div>

                {renderBusy && (
                  <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg space-y-1.5 text-[10px] text-zinc-500">
                    <div className="flex justify-between font-mono text-[9px]">
                      <span>Rendering on server…</span>
                      <span className="animate-pulse">Active</span>
                    </div>
                    <div className="w-full bg-zinc-900 h-1 rounded overflow-hidden">
                      <div className="bg-[#E11D48] h-full w-1/3 animate-pulse" />
                    </div>
                  </div>
                )}

                {renderResult && (
                  <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg space-y-2 text-[10px]">
                    {renderResult.type === "video" ? (
                      <video
                        src={renderResult.url}
                        className="w-full rounded border border-zinc-800 bg-[#020203]"
                        controls
                        loop
                        autoPlay
                        muted
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={renderResult.url}
                        alt="Rendered still"
                        className="w-full rounded border border-zinc-800 bg-[#020203]"
                      />
                    )}
                    <a
                      href={renderResult.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-center gap-1 text-[9px] text-[#E11D48] hover:text-rose-400 font-semibold hover:underline"
                    >
                      Open raw output in new tab
                      <ExternalLink size={10} />
                    </a>
                  </div>
                )}

                {renderError && (
                  <p className="text-red-400 bg-red-950/10 p-2 border border-red-900/20 rounded font-mono leading-relaxed text-[9px]">
                    Error: {renderError}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Library view */
        <div className="space-y-5">
          {/* Library header: filters + AI variant */}
          <div className="border border-zinc-800 rounded-md bg-[#09090b] p-4 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center gap-3">
              <div className="flex bg-zinc-950 border border-zinc-800 rounded p-0.5 text-[11px] font-semibold text-zinc-400 self-start">
                {(["all", "lyric", "quote"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFamilyFilter(f)}
                    className={`px-3 py-1 rounded transition capitalize ${familyFilter === f ? "bg-zinc-800 text-zinc-100" : "hover:text-zinc-200"}`}
                  >
                    {f === "all" ? "All" : f}
                  </button>
                ))}
              </div>

              <div className="relative flex-1 max-w-sm">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600" />
                <input
                  type="text"
                  placeholder="Search name or tag…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded pl-7 pr-2.5 py-1.5 text-zinc-100 focus:outline-none focus:border-zinc-600 text-[11px]"
                />
              </div>

              <button
                onClick={fetchSavedStyles}
                className="self-start md:self-auto flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 rounded transition text-[11px] font-semibold"
                title="Refresh library"
              >
                <RefreshCw size={12} />
                Refresh
              </button>
            </div>

            {/* AI variant */}
            <div className="flex flex-col md:flex-row gap-2 border-t border-zinc-900 pt-3.5">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-400 shrink-0">
                <Sparkles size={12} className="text-[#E11D48]" />
                AI Variant
              </div>
              <input
                type="text"
                placeholder='Describe a style, e.g. "retro VHS karaoke, hot pink on black"'
                value={aiDesc}
                onChange={(e) => setAiDesc(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !aiBusy) handleGenerateAiVariant();
                }}
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-100 focus:outline-none focus:border-zinc-600 text-[11px]"
              />
              <select
                value={aiFamily}
                onChange={(e) => setAiFamily(e.target.value as StyleFamily)}
                className="bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-100 focus:outline-none focus:border-zinc-600 text-[11px]"
              >
                <option value="lyric">Lyric</option>
                <option value="quote">Quote</option>
              </select>
              <button
                onClick={handleGenerateAiVariant}
                disabled={aiBusy}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-[#E11D48] hover:bg-rose-700 text-white font-bold rounded transition text-[11px] disabled:opacity-50 shrink-0"
              >
                {aiBusy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                Generate
              </button>
            </div>
          </div>

          {/* Grid */}
          {loadingStyles ? (
            <div className="flex items-center justify-center py-16 text-zinc-500 text-xs gap-1.5 border border-zinc-800 rounded-md bg-[#09090b]">
              <Loader2 size={12} className="animate-spin text-zinc-400" />
              Loading saved styles...
            </div>
          ) : filteredStyles.length === 0 ? (
            <div className="text-center py-16 space-y-2 text-zinc-500 border border-zinc-800 rounded-md bg-[#09090b]">
              <Layers size={24} className="mx-auto text-zinc-700" />
              <p className="text-xs italic">
                {savedStyles.length === 0
                  ? "No saved styles yet — tune params in the Editor or generate an AI variant above."
                  : "No styles match this filter."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredStyles.map((style) => (
                <div
                  key={style.id}
                  className="bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden flex flex-col transition hover:border-zinc-700"
                >
                  {/* Thumbnail */}
                  <div className="aspect-video bg-[#040406] border-b border-zinc-900 flex items-center justify-center overflow-hidden">
                    {style.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={style.thumbnail} alt={style.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="flex flex-col items-center gap-1.5 text-zinc-700">
                        <ImageIcon size={20} />
                        <span className="text-[9px] font-mono uppercase tracking-wider">
                          {Array.isArray(style.tags) && style.tags.includes("ai") ? "Thumbnail rendering…" : "No thumbnail"}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="p-4 flex flex-col gap-3 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5 min-w-0">
                        {renamingId === style.id ? (
                          <input
                            type="text"
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleRename(style.id);
                              if (e.key === "Escape") setRenamingId("");
                            }}
                            onBlur={() => handleRename(style.id)}
                            className="w-full bg-[#09090b] border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-100 focus:outline-none focus:border-zinc-500 text-xs font-bold"
                          />
                        ) : (
                          <h4 className="text-xs font-bold text-zinc-200 truncate">{style.name}</h4>
                        )}
                        <p className="text-[10px] text-zinc-500 font-mono uppercase">
                          {style.templateKey} · {style.family}
                        </p>
                      </div>
                      <span className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400 text-[9px] font-mono shrink-0">
                        {style.id.substring(0, 8)}
                      </span>
                    </div>

                    {Array.isArray(style.tags) && style.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {style.tags.map((t: string) => (
                          <span
                            key={t}
                            className="px-1.5 py-0.5 rounded bg-[#E11D48]/10 border border-[#E11D48]/25 text-[9px] text-rose-300 font-mono"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center justify-between border-t border-zinc-900 pt-3 mt-auto text-[10px]">
                      <div className="flex gap-1">
                        <button
                          onClick={() => {
                            setRenamingId(style.id);
                            setRenameValue(style.name);
                          }}
                          className="text-zinc-500 hover:text-zinc-200 p-1.5 rounded hover:bg-zinc-900 transition"
                          title="Rename"
                          aria-label={`Rename ${style.name}`}
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          onClick={() => handleDuplicate(style.id)}
                          className="text-zinc-500 hover:text-zinc-200 p-1.5 rounded hover:bg-zinc-900 transition"
                          title="Duplicate & tweak"
                          aria-label={`Duplicate ${style.name}`}
                        >
                          <Copy size={12} />
                        </button>
                        <button
                          onClick={() => handleDelete(style)}
                          className="text-zinc-500 hover:text-red-400 p-1.5 rounded hover:bg-zinc-900 transition"
                          title="Delete"
                          aria-label={`Delete ${style.name}`}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      <button
                        onClick={() => handleLoadStyle(style)}
                        className="bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 font-semibold px-2.5 py-1 rounded transition text-[10px]"
                      >
                        Edit in Lab
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
