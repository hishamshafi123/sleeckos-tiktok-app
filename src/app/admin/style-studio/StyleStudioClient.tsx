"use client";

import React, { useState, useEffect, useRef } from "react";
import { 
  Folder, Sliders, Sparkles, Trash2, Play, Pause, Save, Film, SlidersHorizontal, 
  Layers, Loader2, AlertCircle, CheckCircle, PlusCircle, Layout, Code, Tag, Info, ExternalLink
} from "lucide-react";
import { toast } from "sonner";
import { Player } from "@remotion/player";

// Import compositions directly for live React player rendering
import { BratComposition } from "@/remotion/compositions/Brat";
import { SpotifyLyricsComposition } from "@/remotion/compositions/SpotifyLyrics";
import { QuoteComposition } from "@/remotion/compositions/Quote";

interface StyleParamField {
  key: string;
  label: string;
  type: "text" | "number" | "color" | "boolean";
  defaultValue: any;
  min?: number;
  max?: number;
}

interface StyleStudioClientProps {
  user: {
    id: string;
    role: string;
  };
}

export default function StyleStudioClient({ user }: StyleStudioClientProps) {
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string>("brat");
  const [savedStyles, setSavedStyles] = useState<any[]>([]);
  const [selectedStyleId, setSelectedStyleId] = useState<string>("");
  const [params, setParams] = useState<any>({});
  
  // Forms & configuration states
  const [presetName, setPresetName] = useState<string>("");
  const [tagsInput, setTagsInput] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"builder" | "presets">("builder");
  
  // Status flags
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [loadingPresets, setLoadingPresets] = useState(false);
  const [isSavingPreset, setIsSavingPreset] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  
  // Render Test Job properties
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string>("");
  const [jobOutputUrl, setJobOutputUrl] = useState<string>("");
  const [jobError, setJobError] = useState<string>("");

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Load templates & saved styles on mount
  useEffect(() => {
    fetchTemplates();
    fetchSavedStyles();
  }, []);

  const fetchTemplates = async () => {
    setLoadingTemplates(true);
    try {
      const res = await fetch("/api/managed/style-studio/templates");
      if (!res.ok) throw new Error("Failed to load templates");
      const data = await res.json();
      setTemplates(data);
      if (data.length > 0) {
        // Find default template
        const defaultValue = data.find((t: any) => t.key === "brat") || data[0];
        initializeTemplateParams(defaultValue);
      }
    } catch (err: any) {
      console.error(err);
      toast.error("Failed to load templates");
    } finally {
      setLoadingTemplates(false);
    }
  };

  const fetchSavedStyles = async () => {
    setLoadingPresets(true);
    try {
      const res = await fetch("/api/managed/style-studio/saved-styles");
      if (!res.ok) throw new Error("Failed to load saved styles");
      const data = await res.json();
      setSavedStyles(data);
    } catch (err: any) {
      console.error(err);
      toast.error("Failed to load presets");
    } finally {
      setLoadingPresets(false);
    }
  };

  const initializeTemplateParams = (template: any) => {
    setSelectedTemplateKey(template.key);
    try {
      const fields = JSON.parse(template.paramSchema || "[]");
      const defaults: any = {};
      fields.forEach((f: any) => {
        defaults[f.key] = f.defaultValue;
      });
      setParams(defaults);
    } catch (e) {
      setParams({});
    }
  };

  const handleSelectTemplate = (template: any) => {
    initializeTemplateParams(template);
    setSelectedStyleId("");
    setPresetName("");
    setTagsInput("");
    setJobOutputUrl("");
    setJobError("");
    setActiveJobId(null);
  };

  const handleLoadSavedStyle = (style: any) => {
    setSelectedStyleId(style.id);
    setSelectedTemplateKey(style.templateKey);
    setPresetName(style.name);
    setTagsInput(Array.isArray(style.tags) ? style.tags.join(", ") : "");
    setJobOutputUrl("");
    setJobError("");
    setActiveJobId(null);
    try {
      setParams(JSON.parse(style.params || "{}"));
    } catch (e) {
      setParams({});
    }
    setActiveTab("builder");
    toast.success(`Loaded style preset "${style.name}"`);
  };

  const handleParamChange = (key: string, value: any) => {
    setParams((prev: any) => ({
      ...prev,
      [key]: value
    }));
  };

  // Render Sample Job Creator & Poller
  const handleRenderTestSample = async () => {
    if (!selectedStyleId) {
      toast.error("Please save this style configuration as a preset before rendering a test sample.");
      return;
    }

    setIsRendering(true);
    setJobStatus("QUEUED");
    setJobOutputUrl("");
    setJobError("");
    
    try {
      const res = await fetch("/api/managed/style-studio/render-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          savedStyleId: selectedStyleId,
          inputProps: params,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start render job");

      setActiveJobId(data.id);
      setJobStatus(data.status);
      toast.info("Render job queued. Starting sequential render worker...");

      // Start Polling
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = setInterval(() => checkJobStatus(data.id), 2500);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to submit render job");
      setIsRendering(false);
      setJobStatus("FAILED");
    }
  };

  const checkJobStatus = async (jobId: string) => {
    try {
      const res = await fetch(`/api/managed/style-studio/render-jobs?jobId=${jobId}`);
      if (!res.ok) throw new Error("Failed to poll status");
      const job = await res.json();
      
      setJobStatus(job.status);
      
      if (job.status === "COMPLETED") {
        setJobOutputUrl(job.outputUrl);
        setIsRendering(false);
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        toast.success("Test sample rendered successfully!");
      } else if (job.status === "FAILED") {
        setJobError(job.error || "Unknown rendering failure");
        setIsRendering(false);
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        toast.error("Sample rendering failed.");
      }
    } catch (err) {
      console.error("Polling error:", err);
    }
  };

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  // Save Style Preset
  const handleSaveStylePreset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!presetName.trim()) {
      toast.error("Preset name is required");
      return;
    }

    setIsSavingPreset(true);
    const parsedTags = tagsInput.split(",").map(t => t.trim()).filter(Boolean);

    try {
      let res;
      if (selectedStyleId) {
        // Update existing style preset
        res = await fetch("/api/managed/style-studio/saved-styles", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: selectedStyleId,
            name: presetName.trim(),
            params,
            tags: parsedTags,
          }),
        });
      } else {
        // Save new style preset
        res = await fetch("/api/managed/style-studio/saved-styles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            templateKey: selectedTemplateKey,
            name: presetName.trim(),
            params,
            tags: parsedTags,
          }),
        });
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save preset");

      toast.success(selectedStyleId ? "Preset updated successfully!" : "Preset saved successfully!");
      if (!selectedStyleId) {
        setSelectedStyleId(data.id);
      }
      fetchSavedStyles();
    } catch (err: any) {
      toast.error(err.message || "Failed to save preset configuration");
    } finally {
      setIsSavingPreset(false);
    }
  };

  const handleDeleteSavedStyle = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete style preset "${name}"?`)) return;

    try {
      const res = await fetch(`/api/managed/style-studio/saved-styles?id=${id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete preset");
      }

      toast.success("Style preset deleted");
      if (selectedStyleId === id) {
        setSelectedStyleId("");
        setPresetName("");
        setTagsInput("");
      }
      fetchSavedStyles();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete preset");
    }
  };

  // Find active template schema
  const activeTemplate = templates.find(t => t.key === selectedTemplateKey);
  const paramSchemaFields = activeTemplate ? JSON.parse(activeTemplate.paramSchema || "[]") : [];

  // Match corresponding React composition for player
  const compositionComponent = () => {
    switch (selectedTemplateKey) {
      case "brat":
        return BratComposition;
      case "spotify-lyrics":
        return SpotifyLyricsComposition;
      case "quote":
        return QuoteComposition;
      default:
        return () => null;
    }
  };

  const compositionDuration = () => {
    switch (selectedTemplateKey) {
      case "spotify-lyrics":
        return 450;
      default:
        return 300;
    }
  };

  return (
    <div className="space-y-6 text-zinc-100 bg-[#09090b]">
      
      {/* Workspace Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-zinc-800 pb-5 gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <Layout size={18} className="text-purple-400" />
            <h1 className="text-lg font-bold tracking-tight">Style Studio</h1>
          </div>
          <p className="text-xs text-zinc-500">
            Build, configure, and preview reusable animated layout styles powered by Remotion for Lvon downstream compilers.
          </p>
        </div>

        {/* Tab Selection toggle */}
        <div className="flex bg-zinc-950 border border-zinc-800 rounded p-0.5 text-[11px] font-semibold text-zinc-400 self-start">
          <button
            onClick={() => setActiveTab("builder")}
            className={`px-3 py-1 rounded transition flex items-center gap-1.5 ${activeTab === "builder" ? "bg-zinc-800 text-zinc-100" : "hover:text-zinc-200"}`}
          >
            <SlidersHorizontal size={12} />
            Style Builder
          </button>
          <button
            onClick={() => setActiveTab("presets")}
            className={`px-3 py-1 rounded transition flex items-center gap-1.5 ${activeTab === "presets" ? "bg-zinc-800 text-zinc-100" : "hover:text-zinc-200"}`}
          >
            <Layers size={12} />
            Saved Presets ({savedStyles.length})
          </button>
        </div>
      </div>

      {/* Main Studio View */}
      {activeTab === "builder" ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Left Column: Templates Gallery & Control Panel (Dynamic Schemas) */}
          <div className="lg:col-span-4 space-y-5">
            
            {/* Templates Selector Card */}
            <div className="border border-zinc-800 rounded-md bg-[#09090b] p-4 space-y-3.5">
              <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">1. Select Base Template</h3>
              {loadingTemplates ? (
                <div className="flex items-center justify-center py-6 text-xs text-zinc-600 gap-1.5">
                  <Loader2 size={12} className="animate-spin text-zinc-500" />
                  Loading layouts...
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2">
                  {templates.map((tpl) => {
                    const isSelected = selectedTemplateKey === tpl.key;
                    return (
                      <button
                        key={tpl.key}
                        onClick={() => handleSelectTemplate(tpl)}
                        className={`w-full text-left p-3 rounded-lg border text-xs transition flex flex-col gap-1 ${
                          isSelected 
                            ? "bg-purple-950/20 border-purple-500/30 text-purple-200" 
                            : "bg-[#0c0c0f]/40 border-zinc-800/80 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                        }`}
                      >
                        <span className="font-semibold text-zinc-200">{tpl.name}</span>
                        <span className="text-[10px] text-zinc-600 font-mono uppercase">
                          Engine: {tpl.engine}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Parameter Adjustment Controls */}
            <div className="border border-zinc-800 rounded-md bg-[#09090b] p-4 space-y-4">
              <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                <Sliders size={13} className="text-purple-400" />
                2. Layout Parameters
              </h3>
              
              {paramSchemaFields.length === 0 ? (
                <p className="text-[11px] text-zinc-500 italic">No variables schema defined.</p>
              ) : (
                <div className="space-y-4 text-xs">
                  {paramSchemaFields.map((field: StyleParamField) => {
                    const value = params[field.key] !== undefined ? params[field.key] : field.defaultValue;
                    
                    return (
                      <div key={field.key} className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label className="font-medium text-zinc-300">{field.label}</label>
                          {field.type === "number" && (
                            <span className="font-mono text-purple-400 text-[10px]">{value}</span>
                          )}
                        </div>

                        {field.type === "text" && (
                          <input
                            type="text"
                            value={value}
                            onChange={(e) => handleParamChange(field.key, e.target.value)}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-100 focus:outline-none focus:border-zinc-600 font-mono text-[11px]"
                          />
                        )}

                        {field.type === "color" && (
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={value === "transparent" ? "#000000" : value}
                              onChange={(e) => handleParamChange(field.key, e.target.value)}
                              className="w-8 h-8 rounded border border-zinc-800 cursor-pointer bg-transparent"
                              disabled={value === "transparent"}
                            />
                            <input
                              type="text"
                              value={value}
                              onChange={(e) => handleParamChange(field.key, e.target.value)}
                              className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-100 focus:outline-none focus:border-zinc-600 font-mono text-[11px]"
                            />
                          </div>
                        )}

                        {field.type === "number" && (
                          <input
                            type="range"
                            min={field.min ?? 10}
                            max={field.max ?? 100}
                            step="1"
                            value={value}
                            onChange={(e) => handleParamChange(field.key, parseFloat(e.target.value))}
                            className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                          />
                        )}

                        {field.type === "boolean" && (
                          <label className="relative inline-flex items-center cursor-pointer mt-1">
                            <input
                              type="checkbox"
                              checked={!!value}
                              onChange={(e) => handleParamChange(field.key, e.target.checked)}
                              className="sr-only peer"
                            />
                            <div className="w-9 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-300 after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-600"></div>
                          </label>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>

          {/* Center Column: Live Remotion Player preview */}
          <div className="lg:col-span-5 space-y-5">
            <div className="border border-zinc-800 rounded-md bg-[#09090b] p-4 space-y-4">
              <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                <Film size={13} className="text-purple-400" />
                3. Live Composition Preview
              </h3>
              
              {/* Remotion Player viewport container */}
              <div className="aspect-[9/16] max-h-[580px] w-full max-w-[340px] mx-auto bg-[#040406] rounded-xl overflow-hidden border border-zinc-800 shadow-2xl relative">
                <Player
                  component={compositionComponent() as any}
                  inputProps={params}
                  durationInFrames={compositionDuration()}
                  fps={30}
                  compositionWidth={720}
                  compositionHeight={1280}
                  style={{ width: "100%", height: "100%" }}
                  controls
                  loop
                />
              </div>
              <p className="text-[10px] text-zinc-600 text-center leading-normal">
                Preview operates client-side inside the {"<Player>"} React wrapper. Timings and parameter adjustments refresh instantly.
              </p>
            </div>
          </div>

          {/* Right Column: Presets Saving & Rendering logs */}
          <div className="lg:col-span-3 space-y-5">
            
            {/* Presets Saver panel */}
            <div className="border border-zinc-800 rounded-md bg-[#09090b] p-4 space-y-4">
              <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                <Save size={13} className="text-purple-400" />
                {selectedStyleId ? "4. Update Preset" : "4. Save Preset"}
              </h3>
              
              <form onSubmit={handleSaveStylePreset} className="space-y-3.5 text-xs">
                <div className="space-y-1.5">
                  <label className="font-medium text-zinc-400">Preset Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Brat Neon Green"
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-100 focus:outline-none focus:border-zinc-600 font-semibold"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="font-medium text-zinc-400">Campaign Tags (comma-separated)</label>
                  <input
                    type="text"
                    placeholder="e.g. music, election"
                    value={tagsInput}
                    onChange={(e) => setTagsInput(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-100 focus:outline-none focus:border-zinc-600 font-mono text-[11px]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSavingPreset}
                  className="w-full flex items-center justify-center gap-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-950 font-bold py-2 rounded transition text-[11px] disabled:opacity-50"
                >
                  {isSavingPreset ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  {selectedStyleId ? "Update Presets Config" : "Create Style Preset"}
                </button>
              </form>
            </div>

            {/* Test Sample Renderer Queue */}
            <div className="border border-zinc-800 rounded-md bg-[#09090b] p-4 space-y-4">
              <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles size={13} className="text-purple-400" />
                5. Render Test Sample
              </h3>

              <div className="space-y-3.5 text-xs">
                <p className="text-[10px] text-zinc-500 leading-normal">
                  Renders a short (10-15s) transparent WebM alpha overlay clip programmatically in our background Node queue to confirm output.
                </p>

                <button
                  onClick={handleRenderTestSample}
                  disabled={isRendering}
                  className="w-full flex items-center justify-center gap-1.5 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-200 py-2 rounded transition text-[11px] disabled:opacity-50 font-semibold"
                >
                  {isRendering ? (
                    <>
                      <Loader2 size={12} className="animate-spin text-purple-400" />
                      Rendering...
                    </>
                  ) : (
                    <>
                      <Film size={12} />
                      Render Test Sample
                    </>
                  )}
                </button>

                {/* Render status output */}
                {jobStatus && (
                  <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg space-y-2 text-[10px]">
                    <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5">
                      <span className="text-zinc-500 font-bold uppercase">Queue Monitor</span>
                      <span className={`px-2 py-0.5 rounded font-mono font-semibold text-[9px] ${
                        jobStatus === "COMPLETED" ? "bg-emerald-950/20 text-emerald-400 border border-emerald-900/30" :
                        jobStatus === "FAILED" ? "bg-red-950/20 text-red-400 border border-red-900/30" :
                        "bg-amber-950/20 text-amber-400 border border-amber-900/30"
                      }`}>
                        {jobStatus}
                      </span>
                    </div>

                    {isRendering && (
                      <div className="space-y-1.5 py-1">
                        <div className="flex justify-between text-zinc-500 font-mono text-[9px]">
                          <span>Rendering frames...</span>
                          <span className="animate-pulse">Active</span>
                        </div>
                        <div className="w-full bg-zinc-900 h-1 rounded overflow-hidden">
                          <div className="bg-purple-600 h-full w-1/3 animate-ping" />
                        </div>
                      </div>
                    )}

                    {jobOutputUrl && (
                      <div className="space-y-2 pt-1">
                        <p className="text-zinc-400 font-medium">Output Transparent overlay:</p>
                        <video
                          src={jobOutputUrl}
                          className="w-full rounded border border-zinc-800 bg-[#020203]"
                          controls
                          loop
                        />
                        <a
                          href={jobOutputUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center justify-center gap-1 text-[9px] text-purple-400 hover:text-purple-300 font-semibold hover:underline"
                        >
                          Open raw output in new tab
                          <ExternalLink size={10} />
                        </a>
                      </div>
                    )}

                    {jobError && (
                      <p className="text-red-400 bg-red-950/10 p-2 border border-red-900/20 rounded font-mono leading-relaxed text-[9px]">
                        Error: {jobError}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

          </div>

        </div>
      ) : (
        /* Presets Gallery Tab */
        <div className="border border-zinc-800 rounded-md bg-[#09090b] p-5">
          {loadingPresets ? (
            <div className="flex items-center justify-center py-12 text-zinc-500 text-xs gap-1.5">
              <Loader2 size={12} className="animate-spin text-zinc-400" />
              Loading presets...
            </div>
          ) : savedStyles.length === 0 ? (
            <div className="text-center py-12 space-y-2 text-zinc-500">
              <Layers size={24} className="mx-auto text-zinc-700" />
              <p className="text-xs italic">No style presets saved yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {savedStyles.map((style) => (
                <div
                  key={style.id}
                  className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 flex flex-col justify-between gap-4 transition hover:border-zinc-700 hover:shadow-lg"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <h4 className="text-xs font-bold text-zinc-200">{style.name}</h4>
                        <p className="text-[10px] text-zinc-500 font-mono uppercase">
                          Template: {style.templateKey}
                        </p>
                      </div>
                      <span className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400 text-[9px] font-mono">
                        ID: {style.id.substring(0, 8)}
                      </span>
                    </div>

                    {/* Preset properties snippet */}
                    <div className="p-2.5 bg-[#09090b] rounded border border-zinc-900 font-mono text-[9px] text-zinc-500 space-y-1 max-h-[80px] overflow-y-auto">
                      {Object.entries(JSON.parse(style.params || "{}")).map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-2">
                          <span className="truncate">{k}:</span>
                          <span className="text-zinc-400 truncate">{String(v)}</span>
                        </div>
                      ))}
                    </div>

                    {/* Preset tags */}
                    {style.tags && style.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {style.tags.map((t: string) => (
                          <span key={t} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-purple-950/20 border border-purple-900/30 text-[9px] text-purple-300 font-mono">
                            <Tag size={8} />
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between border-t border-zinc-900 pt-3 text-[10px]">
                    <span className="text-zinc-600">Created by {style.createdBy ? style.createdBy.substring(0, 8) : "System"}</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDeleteSavedStyle(style.id, style.name)}
                        className="text-zinc-500 hover:text-red-400 p-1"
                        title="Delete Preset"
                      >
                        <Trash2 size={12} />
                      </button>
                      <button
                        onClick={() => handleLoadSavedStyle(style)}
                        className="bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 font-semibold px-2.5 py-1 rounded transition text-[10px]"
                      >
                        Load to Studio
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
