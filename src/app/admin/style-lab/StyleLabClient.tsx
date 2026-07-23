"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, Copy, Film, FlaskConical, Image as ImageIcon, Layers, LayoutGrid,
  Library, Loader2, Pencil, RefreshCw, Save, Search, Sliders, Sparkles,
  Trash2, ExternalLink,
} from "lucide-react";
import { toast } from "sonner";

import { FONT_MANIFEST, nearestAvailableWeight } from "@/lib/fonts";
import {
  LYRIC_PARAM_SCHEMA,
  defaultParams,
  type ParamField,
  type StyleFamily,
  type StyleParams,
} from "@/lib/style-lab/schema";
import {
  LEGACY_MAIN_LAYER_ID,
  LAYERED_TEMPLATE_KEY,
  coerceLayers,
  defaultImageLayer,
  defaultShapeLayer,
  defaultTextLayer,
  legacyParamsToLayers,
  newLayerId,
  type LayerType,
  type StyleLayer,
} from "@/lib/style-lab/layers";
import { LayerEditor } from "./LayerEditor";
import { LayerPanel } from "./LayerPanel";
import { NewTemplateDialog } from "./NewTemplateDialog";
import { StylePreviewPanel } from "./StylePreviewPanel";
import { TemplateGallery, type GalleryTemplate } from "./TemplateGallery";

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

  const [view, setView] = useState<"gallery" | "editor">("gallery");
  const [galleryTab, setGalleryTab] = useState<"templates" | "saved">("templates");
  const [templates, setTemplates] = useState<any[]>([]);
  const [fonts, setFonts] = useState<FontInfo[]>([]);
  const [savedStyles, setSavedStyles] = useState<any[]>([]);

  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string>("lyric-caption");
  const [params, setParams] = useState<StyleParams>({});
  const [selectedStyleId, setSelectedStyleId] = useState<string>("");
  const [styleName, setStyleName] = useState<string>("");
  const [tagsInput, setTagsInput] = useState<string>("");

  // Layer stack. layeredMode=false → legacy single-layer style: the flat
  // params ARE the main text layer (synthesized on the fly). Adding a layer
  // materializes the stack and flips layeredMode on.
  const [layers, setLayers] = useState<StyleLayer[]>([]);
  const [layeredMode, setLayeredMode] = useState(false);
  const [selectedLayerId, setSelectedLayerId] = useState<string>(LEGACY_MAIN_LAYER_ID);

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

  // AI draft pipeline (Part 7, admin): New-template dialog + drafts shelf.
  const isAdmin = user.role === "admin";
  const [showNewTemplate, setShowNewTemplate] = useState(false);
  const [draftGenBusy, setDraftGenBusy] = useState(false);
  const [draftBusyKey, setDraftBusyKey] = useState<string | null>(null);
  /** Draft template currently open in the editor (null = not editing a draft). */
  const [editingDraft, setEditingDraft] = useState<GalleryTemplate | null>(null);
  const [draftSaving, setDraftSaving] = useState(false);

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
      // Layered saved styles (forks of published AI templates) have no
      // gallery row — use the lyric superset schema for the canvas panel.
      if (templateKey === LAYERED_TEMPLATE_KEY) return LYRIC_PARAM_SCHEMA;
      const tpl = templates.find((t) => t.key === templateKey);
      if (!tpl) return [];
      try {
        const parsed = JSON.parse(tpl.paramSchema || "[]");
        // AI draft rows store { fields, layers, defaultParams, family }.
        if (Array.isArray(parsed)) return parsed;
        if (parsed && Array.isArray(parsed.fields)) return parsed.fields;
        return [];
      } catch {
        return [];
      }
    },
    [templates]
  );

  const schema = useMemo(() => schemaOf(selectedTemplateKey), [schemaOf, selectedTemplateKey]);
  const selectedTemplate = useMemo(
    () => templates.find((t) => t.key === selectedTemplateKey) ?? null,
    [templates, selectedTemplateKey]
  );
  const family: StyleFamily = selectedTemplate?.family === "quote" ? "quote" : "lyric";

  // ─── Layer stack ───────────────────────────────────────────────────────────

  /** Stack shown in the layer panel / preview drag layer. */
  const effectiveLayers = useMemo<StyleLayer[]>(
    () => (layeredMode ? layers : legacyParamsToLayers(selectedTemplateKey, params)),
    [layeredMode, layers, selectedTemplateKey, params],
  );

  const selectedLayer = useMemo(
    () => effectiveLayers.find((l) => l.id === selectedLayerId) ?? null,
    [effectiveLayers, selectedLayerId],
  );

  const resetLayers = () => {
    setLayers([]);
    setLayeredMode(false);
    setSelectedLayerId(LEGACY_MAIN_LAYER_ID);
  };

  /** Adds a layer; materializes the stack (legacy → layered) when needed. */
  const handleAddLayer = (type: LayerType) => {
    const base = layeredMode ? layers : legacyParamsToLayers(selectedTemplateKey, params);
    const layer =
      type === "text"
        ? defaultTextLayer("attribution")
        : type === "image"
          ? defaultImageLayer()
          : defaultShapeLayer();
    layer.zIndex = base.length;
    setLayers([...base, layer]);
    setLayeredMode(true);
    setSelectedLayerId(layer.id);
  };

  const handleSelectLayer = (id: string) => {
    if (!layeredMode) {
      setSelectedLayerId(LEGACY_MAIN_LAYER_ID);
      return;
    }
    setSelectedLayerId(id);
  };

  const handleLayerChange = (id: string, patch: Partial<StyleLayer>) => {
    if (!layeredMode) return; // legacy main layer edits go through flat params
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const handleRemoveLayer = (id: string) => {
    if (!layeredMode || layers.length <= 1) return;
    setLayers((prev) =>
      prev.filter((l) => l.id !== id).map((l, i) => ({ ...l, zIndex: i })),
    );
    if (selectedLayerId === id) setSelectedLayerId(layers.find((l) => l.id !== id)?.id ?? "");
  };

  const handleDuplicateLayer = (id: string) => {
    if (!layeredMode) return;
    const source = layers.find((l) => l.id === id);
    if (!source) return;
    const copy: StyleLayer = {
      ...source,
      id: newLayerId(),
      name: `${source.name} (copy)`.slice(0, 60),
      yPercent: Math.min(100, source.yPercent + 4),
      zIndex: layers.length,
    };
    setLayers([...layers, copy]);
    setSelectedLayerId(copy.id);
  };

  const handleMoveLayer = (id: string, dir: -1 | 1) => {
    if (!layeredMode) return;
    setLayers((prev) => {
      const idx = prev.findIndex((l) => l.id === id);
      const next = idx + dir;
      if (idx < 0 || next < 0 || next >= prev.length) return prev;
      const arr = [...prev];
      [arr[idx], arr[next]] = [arr[next], arr[idx]];
      return arr.map((l, i) => ({ ...l, zIndex: i }));
    });
  };

  const handleToggleLayerVisible = (id: string) => {
    if (!layeredMode) return;
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)));
  };

  function initFromTemplate(tpl: any) {
    setSelectedTemplateKey(tpl.key);
    // Per-template defaults: the gallery API ships defaultParams computed
    // from the row's schema (brat/imported rows carry their own defaults).
    if (tpl.defaultParams && Object.keys(tpl.defaultParams).length > 0) {
      setParams(tpl.defaultParams);
      return;
    }
    try {
      const fields: ParamField[] = JSON.parse(tpl.paramSchema || "[]");
      setParams(defaultParams(fields));
    } catch {
      setParams({});
    }
  }

  const handleUseTemplate = (tpl: any) => {
    initFromTemplate(tpl);
    setSelectedStyleId("");
    resetLayers();
    // AI templates (draft or published) are layered styles: load the stack.
    const tplLayers = coerceLayers(tpl.layers);
    if (tplLayers.length > 0) {
      setLayers(tplLayers);
      setLayeredMode(true);
      setSelectedLayerId(tplLayers.find((l) => l.bind)?.id ?? tplLayers[tplLayers.length - 1].id);
    }
    if (tpl.status === "draft") {
      // Drafts keep their name/tags so "Update Draft" can PATCH them.
      setEditingDraft(tpl);
      setStyleName(tpl.name);
      setTagsInput(Array.isArray(tpl.tags) ? tpl.tags.filter((t: string) => !["style-lab", "base"].includes(t)).join(", ") : "");
    } else {
      setEditingDraft(null);
      // Prefill a sensible name so saving a new style is literally one click.
      setStyleName(`${tpl.name} — Custom`);
      setTagsInput("");
    }
    setRenderResult(null);
    setRenderError("");
    setView("editor");
  };

  /** Fork a gallery template into the saved-styles library. */
  const handleDuplicateTemplate = async (tpl: any) => {
    try {
      const res = await fetch("/api/style-lab/saved-styles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateKey: tpl.key,
          name: `${tpl.name} (copy)`.slice(0, 120),
          params: tpl.defaultParams ?? {},
          tags: Array.isArray(tpl.tags)
            ? tpl.tags.filter((t: string) => !["style-lab", "base"].includes(t))
            : [],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to duplicate");
      toast.success(`Forked as saved style "${data.name}" — thumbnail rendering in background`);
      fetchSavedStyles();
      scheduleLibraryRefresh();
    } catch (err: any) {
      toast.error(err.message || "Failed to duplicate template");
    }
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
    setEditingDraft(null);
    setSelectedStyleId(style.id);
    setSelectedTemplateKey(style.templateKey);
    setStyleName(style.name);
    setTagsInput(Array.isArray(style.tags) ? style.tags.join(", ") : "");
    setParams(typeof style.params === "object" ? style.params : {});
    const styleLayers = coerceLayers(style.layers);
    if (styleLayers.length > 0) {
      setLayers(styleLayers);
      setLayeredMode(true);
      setSelectedLayerId(styleLayers.find((l) => l.bind)?.id ?? styleLayers[styleLayers.length - 1].id);
    } else {
      resetLayers();
    }
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
    setEditingDraft(null);
    resetLayers();
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
          body: JSON.stringify({
            name: styleName.trim(),
            params,
            tags,
            layers: layeredMode ? layers : null, // null reverts to legacy single-layer
          }),
        });
      } else {
        res = await fetch("/api/style-lab/saved-styles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            templateKey: selectedTemplateKey,
            name: styleName.trim(),
            params,
            tags,
            ...(layeredMode ? { layers } : {}),
          }),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save style");
      toast.success(selectedStyleId ? "Style updated" : `Style saved as "${data.name ?? styleName.trim()}" — find it in Saved Styles`);
      if (!selectedStyleId) setSelectedStyleId(data.id);
      fetchSavedStyles();
      scheduleLibraryRefresh();
      // Take the operator to their library so the save is visibly confirmed.
      if (!selectedStyleId) {
        setView("gallery");
        setGalleryTab("saved");
      }
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
        body: JSON.stringify({
          templateKey: selectedTemplateKey,
          params,
          format,
          ...(layeredMode ? { layers } : {}),
        }),
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

  // ─── AI draft pipeline (Part 7, admin) ────────────────────────────────────

  const handleCreateDraft = async (description: string, family: StyleFamily) => {
    setDraftGenBusy(true);
    try {
      const res = await fetch("/api/style-lab/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, family }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Draft generation failed");
      toast.success(`Draft "${data.name}" created — find it on the Drafts shelf`);
      setShowNewTemplate(false);
      fetchTemplates();
    } catch (err: any) {
      toast.error(err.message || "Draft generation failed");
    } finally {
      setDraftGenBusy(false);
    }
  };

  const handleValidateDraft = async (tpl: GalleryTemplate) => {
    setDraftBusyKey(tpl.key);
    try {
      const res = await fetch(`/api/style-lab/drafts/${tpl.id}/validate`, { method: "POST" });
      const data = await res.json();
      // 422 = checks ran but failed; 4xx/5xx without checks = hard error.
      if (!data.checks && !res.ok) throw new Error(data.error || "Validation failed");
      if (data.ok) {
        toast.success("Draft validated — schema, transparency and render all pass. Ready to publish.");
      } else {
        toast.error(`Validation failed: ${(data.errors ?? [])[0] ?? "unknown error"}`);
      }
      fetchTemplates();
    } catch (err: any) {
      toast.error(err.message || "Validation failed");
    } finally {
      setDraftBusyKey(null);
    }
  };

  const handlePublishDraft = async (tpl: GalleryTemplate) => {
    setDraftBusyKey(tpl.key);
    try {
      const res = await fetch(`/api/style-lab/drafts/${tpl.id}/publish`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Publish failed");
      toast.success(`"${data.name}" published to the template library`);
      if (editingDraft?.id === tpl.id) setEditingDraft(null);
      fetchTemplates();
    } catch (err: any) {
      toast.error(err.message || "Publish failed");
    } finally {
      setDraftBusyKey(null);
    }
  };

  const handleDeleteDraft = async (tpl: GalleryTemplate) => {
    if (!window.confirm(`Delete draft "${tpl.name}"? This cannot be undone.`)) return;
    setDraftBusyKey(tpl.key);
    try {
      const res = await fetch(`/api/style-lab/drafts/${tpl.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      toast.success("Draft deleted");
      if (editingDraft?.id === tpl.id) {
        setEditingDraft(null);
        setView("gallery");
      }
      fetchTemplates();
    } catch (err: any) {
      toast.error(err.message || "Delete failed");
    } finally {
      setDraftBusyKey(null);
    }
  };

  /** Editor "Update Draft": persists the current params/layers/name to the draft row (resets validation). */
  const handleUpdateDraft = async () => {
    if (!editingDraft) return;
    if (layeredMode && layers.length === 0) {
      toast.error("A draft needs at least one layer");
      return;
    }
    setDraftSaving(true);
    const tags = tagsInput.split(",").map((t) => t.trim()).filter(Boolean);
    try {
      const res = await fetch(`/api/style-lab/drafts/${editingDraft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(styleName.trim() ? { name: styleName.trim() } : {}),
          tags,
          defaultParams: params,
          layers: layeredMode ? layers : (editingDraft.layers ?? []),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update draft");
      toast.success("Draft updated — validation reset; re-validate before publishing");
      setEditingDraft(data);
      fetchTemplates();
    } catch (err: any) {
      toast.error(err.message || "Failed to update draft");
    } finally {
      setDraftSaving(false);
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

  /** Flat-param groups that still apply to layered styles (canvas + lyric engine). */
  const canvasGroups = useMemo(() => {
    const KEYS = new Set([
      "bgColor",
      "aspectRatio",
      "lineMode",
      "linesVisible",
      "timingOffsetMs",
      "pixelate",
      "blur",
      "vignette",
      "grain",
      "noise",
    ]);
    return groups
      .map((g) => ({ name: g.name, fields: g.fields.filter((f) => KEYS.has(f.key)) }))
      .filter((g) => g.fields.length > 0);
  }, [groups]);

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
      case "text":
        return (
          <textarea
            rows={2}
            value={String(value ?? "")}
            onChange={(e) => handleParamChange(field.key, e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-100 focus:outline-none focus:border-zinc-600 text-[11px] resize-y"
          />
        );

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
            {view === "editor" && (
              <span className="text-xs text-zinc-500 font-mono">
                / {selectedTemplate?.name ?? selectedTemplateKey}
              </span>
            )}
            {view === "editor" && editingDraft && (
              <span className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-[9px] font-mono uppercase tracking-wider text-amber-300">
                Draft
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-500">
            {view === "editor"
              ? "Tune params live in the player, save presets, or test-render a clip."
              : "Pick a template to start — hover a card for an animated preview."}
          </p>
        </div>

        <div className="flex items-center gap-2 self-start">
          {view === "gallery" && galleryTab === "templates" && isAdmin && (
            <button
              onClick={() => setShowNewTemplate(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#E11D48] hover:bg-rose-700 text-white font-bold rounded transition text-[11px]"
            >
              <Sparkles size={12} />
              New Template
            </button>
          )}
          <div className="flex bg-zinc-950 border border-zinc-800 rounded p-0.5 text-[11px] font-semibold text-zinc-400">
          {view === "editor" ? (
            <button
              onClick={() => setView("gallery")}
              className="px-3 py-1 rounded transition flex items-center gap-1.5 hover:text-zinc-200"
            >
              <ArrowLeft size={12} />
              Back to Gallery
            </button>
          ) : (
            <>
              <button
                onClick={() => setGalleryTab("templates")}
                className={`px-3 py-1 rounded transition flex items-center gap-1.5 ${galleryTab === "templates" ? "bg-zinc-800 text-zinc-100" : "hover:text-zinc-200"}`}
              >
                <LayoutGrid size={12} />
                Templates
              </button>
              <button
                onClick={() => setGalleryTab("saved")}
                className={`px-3 py-1 rounded transition flex items-center gap-1.5 ${galleryTab === "saved" ? "bg-zinc-800 text-zinc-100" : "hover:text-zinc-200"}`}
              >
                <Library size={12} />
                Saved Styles ({savedStyles.length})
              </button>
            </>
          )}
          </div>
        </div>
      </div>

      {view === "editor" ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: layers + control panel */}
          <div className="lg:col-span-4 space-y-5">
            <LayerPanel
              layers={effectiveLayers}
              layeredMode={layeredMode}
              selectedLayerId={selectedLayerId}
              onSelect={handleSelectLayer}
              onAdd={handleAddLayer}
              onRemove={handleRemoveLayer}
              onDuplicate={handleDuplicateLayer}
              onMove={handleMoveLayer}
              onToggleVisible={handleToggleLayerVisible}
            />

            {layeredMode ? (
              <>
                {/* Selected layer controls */}
                <div className="border border-zinc-800 rounded-md bg-[#09090b] p-4 space-y-5">
                  <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Sliders size={13} className="text-[#E11D48]" />
                    2. Layer Settings
                    {selectedLayer && (
                      <span className="ml-auto text-[10px] font-mono text-zinc-500 normal-case truncate">
                        {selectedLayer.name}
                      </span>
                    )}
                  </h3>
                  {selectedLayer ? (
                    <LayerEditor
                      layer={selectedLayer}
                      fonts={fonts}
                      onChange={(patch) => handleLayerChange(selectedLayer.id, patch)}
                    />
                  ) : (
                    <p className="text-[11px] text-zinc-500 italic">Select a layer above to edit it.</p>
                  )}
                </div>

                {/* Canvas-wide + lyric-engine params (flat params still drive these) */}
                {canvasGroups.length > 0 && (
                  <div className="border border-zinc-800 rounded-md bg-[#09090b] p-4 space-y-5">
                    <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Sliders size={13} className="text-[#E11D48]" />
                      Canvas &amp; Lyrics
                    </h3>
                    {canvasGroups.map((group) => (
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
                    ))}
                  </div>
                )}
              </>
            ) : (
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
            )}
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
              layers={layeredMode ? layers : null}
              selectedLayerId={selectedLayerId}
              onSelectLayer={handleSelectLayer}
              onLayerChange={handleLayerChange}
            />
          </div>

          {/* Right: save + test render */}
          <div className="lg:col-span-4 space-y-5">
            <div className="border border-zinc-800 rounded-md bg-[#09090b] p-4 space-y-4">
              <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                <Save size={13} className="text-[#E11D48]" />
                {editingDraft ? "4. Edit Draft" : selectedStyleId ? "4. Update Style" : "4. Save Style"}
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

                {editingDraft ? (
                  <>
                    {isAdmin && (
                      <button
                        onClick={handleUpdateDraft}
                        disabled={draftSaving}
                        className="w-full flex items-center justify-center gap-1.5 bg-[#E11D48] hover:bg-rose-700 text-white font-bold py-2 rounded transition text-[11px] disabled:opacity-50"
                      >
                        {draftSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                        Update Draft
                      </button>
                    )}
                    <p className="text-[10px] text-amber-300/80 leading-normal">
                      Drafts cannot be saved into the library. Editing resets validation —
                      re-validate on the Drafts shelf, then publish.
                    </p>
                  </>
                ) : (
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
                )}
                {selectedStyleId && !editingDraft && (
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
      ) : galleryTab === "templates" ? (
        /* Gallery home: template cards with hover previews */
        <TemplateGallery
          templates={templates}
          loading={loadingTemplates}
          isAdmin={isAdmin}
          onUse={handleUseTemplate}
          onDuplicate={handleDuplicateTemplate}
          onValidate={handleValidateDraft}
          onPublish={handlePublishDraft}
          onDeleteDraft={handleDeleteDraft}
          draftBusyKey={draftBusyKey}
        />
      ) : (
        /* Saved styles tab */
        <div className="space-y-5">
          {/* Saved styles header: filters + AI variant */}
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

      {showNewTemplate && (
        <NewTemplateDialog
          busy={draftGenBusy}
          onClose={() => setShowNewTemplate(false)}
          onSubmit={handleCreateDraft}
        />
      )}
    </div>
  );
}
