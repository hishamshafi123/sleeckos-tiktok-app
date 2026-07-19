"use client";
import React, { useState, useEffect } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Edit2, X, AlertTriangle, Save } from "lucide-react";

type ColorSetting = {
  id: string;
  color: string;
  meaning: string;
  defaultPostCount: number;
  order: number;
};

const DUMMY_COLORS = [
  { value: "green", name: "Green" },
  { value: "red", name: "Red" },
  { value: "orange", name: "Orange" },
  { value: "yellow", name: "Yellow" },
  { value: "blue", name: "Blue" },
  { value: "purple", name: "Purple" },
  { value: "pink", name: "Pink" },
  { value: "zinc", name: "Gray" },
];

export default function ColorSettingsModal({ onClose }: { onClose: () => void }) {
  const [colors, setColors] = useState<ColorSetting[]>([]);
  const [fallbackCount, setFallbackCount] = useState<number>(1);
  const [loading, setLoading] = useState(true);
  
  // Create Form State
  const [newColor, setNewColor] = useState({
    color: "green",
    customHex: "",
    meaning: "",
    defaultPostCount: 1,
    order: 0,
  });
  const [isAdding, setIsAdding] = useState(false);

  // Edit Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    color: "green",
    customHex: "",
    meaning: "",
    defaultPostCount: 1,
    order: 0,
  });
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Delete/Reassign Flow
  const [deletingColor, setDeletingColor] = useState<ColorSetting | null>(null);
  const [reassignToId, setReassignToId] = useState<string>("");
  const [inUseAccountCount, setInUseAccountCount] = useState<number>(0);
  const [checkingInUse, setCheckingInUse] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/managed/accounts/colors");
      if (res.ok) {
        const data = await res.json();
        setColors(data.colors || []);
        setFallbackCount(data.defaultPostCountFallback ?? 1);
      }
    } catch (err) {
      toast.error("Failed to load color settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSaveFallback = async () => {
    try {
      const res = await fetch("/api/managed/accounts/colors", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultPostCountFallback: fallbackCount }),
      });
      if (res.ok) {
        toast.success("Global fallback post count updated");
      } else {
        const data = await res.json();
        throw new Error(data.error || "Failed to update global fallback");
      }
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleAddColor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newColor.meaning.trim()) {
      toast.error("Color meaning is required");
      return;
    }
    const colorVal = newColor.color === "custom" ? newColor.customHex.trim() : newColor.color;
    if (!colorVal) {
      toast.error("Please enter a custom hex color code or select a preset color");
      return;
    }

    setIsAdding(true);
    try {
      const res = await fetch("/api/managed/accounts/colors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          color: colorVal,
          meaning: newColor.meaning.trim(),
          defaultPostCount: newColor.defaultPostCount,
          order: newColor.order,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create color");
      }

      toast.success("Color setting created successfully");
      setNewColor({
        color: "green",
        customHex: "",
        meaning: "",
        defaultPostCount: 1,
        order: colors.length + 1,
      });
      fetchSettings();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsAdding(false);
    }
  };

  const startEdit = (c: ColorSetting) => {
    setEditingId(c.id);
    const isPreset = DUMMY_COLORS.some(dc => dc.value === c.color);
    setEditForm({
      color: isPreset ? c.color : "custom",
      customHex: isPreset ? "" : c.color,
      meaning: c.meaning,
      defaultPostCount: c.defaultPostCount,
      order: c.order,
    });
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) return;
    if (!editForm.meaning.trim()) {
      toast.error("Color meaning is required");
      return;
    }
    const colorVal = editForm.color === "custom" ? editForm.customHex.trim() : editForm.color;
    if (!colorVal) {
      toast.error("Please enter a custom hex color code");
      return;
    }

    setIsSavingEdit(true);
    try {
      const res = await fetch("/api/managed/accounts/colors", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingId,
          color: colorVal,
          meaning: editForm.meaning.trim(),
          defaultPostCount: editForm.defaultPostCount,
          order: editForm.order,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update color");
      }

      toast.success("Color settings updated");
      setEditingId(null);
      fetchSettings();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const startDelete = async (c: ColorSetting) => {
    setCheckingInUse(true);
    setDeletingColor(c);
    try {
      // Find out how many accounts use this color
      const res = await fetch(`/api/managed/accounts/all`);
      if (res.ok) {
        const allAccounts = await res.json();
        const count = allAccounts.filter((a: any) => a.colorId === c.id || (!a.colorId && a.color === c.color)).length;
        setInUseAccountCount(count);
        // Default reassign dropdown to first available color
        const otherColors = colors.filter(color => color.id !== c.id);
        if (otherColors.length > 0) {
          setReassignToId(otherColors[0].id);
        } else {
          setReassignToId("");
        }
      }
    } catch (err) {
      toast.error("Failed to check if color is in use");
    } finally {
      setCheckingInUse(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingColor) return;
    setIsDeleting(true);
    try {
      let url = `/api/managed/accounts/colors?id=${deletingColor.id}`;
      if (inUseAccountCount > 0) {
        if (!reassignToId) {
          toast.error("Reassignment color is required to migrate affected accounts.");
          setIsDeleting(false);
          return;
        }
        url += `&reassignToId=${reassignToId}`;
      }

      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete color");
      }

      toast.success("Color deleted successfully");
      setDeletingColor(null);
      fetchSettings();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div className="relative w-full max-w-4xl bg-[#09090b] border border-white/10 rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto custom-scrollbar flex flex-col text-white">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-xl font-bold text-white mb-6">Account Color Settings</h2>

        {loading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-6 h-6 text-purple-500 animate-spin" />
          </div>
        ) : (
          <div className="space-y-8 flex-1">
            {/* Global Setting Section */}
            <div className="p-4 bg-white/5 rounded-xl border border-white/5 space-y-3">
              <h3 className="text-sm font-semibold text-gray-200">Global Fallback Count</h3>
              <p className="text-xs text-gray-400">
                This fallback value applies to any managed account with no assigned card color.
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min="0"
                  value={fallbackCount}
                  onChange={(e) => setFallbackCount(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white w-28 focus:outline-none focus:border-purple-500"
                />
                <button
                  onClick={handleSaveFallback}
                  className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-all"
                >
                  <Save className="w-3.5 h-3.5" /> Save Global Default
                </button>
              </div>
            </div>

            {/* Colors Management List */}
            <div className="grid md:grid-cols-3 gap-6">
              {/* Color list display */}
              <div className="md:col-span-2 space-y-4">
                <h3 className="text-sm font-semibold text-gray-200 uppercase tracking-wider text-[10px] text-gray-400">
                  Configured Swatches & Post Thresholds
                </h3>

                <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1 custom-scrollbar">
                  {colors.map((c) => {
                    const isPreset = DUMMY_COLORS.some(dc => dc.value === c.color);
                    const baseColor = isPreset ? (c.color === "zinc" || c.color === "gray" ? "#71717a" : c.color) : c.color;
                    const hexColor = c.color.startsWith("#") ? c.color : (baseColor === "green" ? "#10b981" : baseColor === "red" ? "#ef4444" : baseColor === "orange" ? "#f97316" : baseColor === "yellow" ? "#f59e0b" : baseColor === "blue" ? "#3b82f6" : baseColor === "purple" ? "#8b5cf6" : baseColor === "pink" ? "#ec4899" : "#71717a");

                    const isEditing = editingId === c.id;

                    return (
                      <div
                        key={c.id}
                        className="flex items-center justify-between p-3.5 bg-white/3 border border-white/5 rounded-xl transition-all"
                      >
                        {isEditing ? (
                          <form onSubmit={handleSaveEdit} className="w-full space-y-3">
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[10px] text-gray-400 mb-1">Color Swatch</label>
                                <select
                                  value={editForm.color}
                                  onChange={(e) => setEditForm({ ...editForm, color: e.target.value })}
                                  className="w-full bg-[#111] border border-white/10 rounded px-2 py-1 text-xs text-white"
                                >
                                  {DUMMY_COLORS.map((dc) => (
                                    <option key={dc.value} value={dc.value}>{dc.name}</option>
                                  ))}
                                  <option value="custom">Custom (Hex Code)</option>
                                </select>
                              </div>

                              {editForm.color === "custom" && (
                                <div>
                                  <label className="block text-[10px] text-gray-400 mb-1">Hex Color Code</label>
                                  <input
                                    type="text"
                                    placeholder="#FF00FF"
                                    value={editForm.customHex}
                                    onChange={(e) => setEditForm({ ...editForm, customHex: e.target.value })}
                                    className="w-full bg-[#111] border border-white/10 rounded px-2 py-1 text-xs text-white font-mono"
                                  />
                                </div>
                              )}
                            </div>

                            <div className="grid grid-cols-3 gap-2">
                              <div className="col-span-2">
                                <label className="block text-[10px] text-gray-400 mb-1">Meaning (e.g. Banned)</label>
                                <input
                                  type="text"
                                  value={editForm.meaning}
                                  onChange={(e) => setEditForm({ ...editForm, meaning: e.target.value })}
                                  className="w-full bg-[#111] border border-white/10 rounded px-2 py-1 text-xs text-white"
                                />
                              </div>

                              <div>
                                <label className="block text-[10px] text-gray-400 mb-1">Default Post Count</label>
                                <input
                                  type="number"
                                  min="0"
                                  value={editForm.defaultPostCount}
                                  onChange={(e) => setEditForm({ ...editForm, defaultPostCount: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                                  className="w-full bg-[#111] border border-white/10 rounded px-2 py-1 text-xs text-white"
                                />
                              </div>
                            </div>

                            <div className="flex justify-end gap-2 pt-2">
                              <button
                                type="button"
                                onClick={() => setEditingId(null)}
                                className="px-2.5 py-1 text-[10px] bg-white/5 hover:bg-white/10 text-white rounded transition-colors"
                              >
                                Cancel
                              </button>
                              <button
                                type="submit"
                                disabled={isSavingEdit}
                                className="px-2.5 py-1 text-[10px] bg-purple-600 hover:bg-purple-500 text-white rounded font-bold transition-colors flex items-center gap-1"
                              >
                                {isSavingEdit && <Loader2 className="w-3 h-3 animate-spin" />}
                                Save Changes
                              </button>
                            </div>
                          </form>
                        ) : (
                          <>
                            <div className="flex items-center gap-3 truncate mr-2">
                              <span
                                className="w-3.5 h-3.5 rounded-full flex-shrink-0"
                                style={{ backgroundColor: hexColor }}
                              />
                              <div className="truncate">
                                <p className="font-semibold text-sm text-gray-200">{c.meaning}</p>
                                <p className="text-[10px] text-gray-500 font-mono mt-0.5">
                                  value: {c.color} | default: {c.defaultPostCount} posts
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <button
                                onClick={() => startEdit(c)}
                                className="p-1.5 hover:bg-white/5 text-gray-400 hover:text-white rounded transition-colors"
                                title="Edit Color"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => startDelete(c)}
                                className="p-1.5 hover:bg-red-500/10 text-red-400 hover:text-red-300 rounded transition-colors"
                                title="Delete Color"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                  {colors.length === 0 && (
                    <p className="text-xs text-gray-500 italic p-4 text-center">No configurable colors found.</p>
                  )}
                </div>
              </div>

              {/* Add New Color Form */}
              <div className="p-4 bg-white/5 border border-white/5 rounded-2xl flex flex-col justify-between">
                <form onSubmit={handleAddColor} className="space-y-4">
                  <h3 className="text-xs font-semibold text-gray-200 uppercase tracking-wider text-[10px] text-gray-400">
                    Add New Swatch Config
                  </h3>

                  <div>
                    <label className="block text-[10px] text-gray-400 mb-1">Color Type</label>
                    <select
                      value={newColor.color}
                      onChange={(e) => setNewColor({ ...newColor, color: e.target.value })}
                      className="w-full bg-[#09090b] border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
                    >
                      {DUMMY_COLORS.map((dc) => (
                        <option key={dc.value} value={dc.value}>{dc.name}</option>
                      ))}
                      <option value="custom">Custom Hex Color</option>
                    </select>
                  </div>

                  {newColor.color === "custom" && (
                    <div>
                      <label className="block text-[10px] text-gray-400 mb-1">Custom Hex Code</label>
                      <input
                        type="text"
                        placeholder="#ef4444"
                        value={newColor.customHex}
                        onChange={(e) => setNewColor({ ...newColor, customHex: e.target.value })}
                        className="w-full bg-[#09090b] border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-purple-500"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-[10px] text-gray-400 mb-1">Meaning / Display Label</label>
                    <input
                      type="text"
                      placeholder="e.g. Healthy, Warming"
                      value={newColor.meaning}
                      onChange={(e) => setNewColor({ ...newColor, meaning: e.target.value })}
                      className="w-full bg-[#09090b] border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] text-gray-400 mb-1">Default Post Count</label>
                    <input
                      type="number"
                      min="0"
                      value={newColor.defaultPostCount}
                      onChange={(e) => setNewColor({ ...newColor, defaultPostCount: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                      className="w-full bg-[#09090b] border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] text-gray-400 mb-1">Display Sort Order</label>
                    <input
                      type="number"
                      value={newColor.order}
                      onChange={(e) => setNewColor({ ...newColor, order: parseInt(e.target.value, 10) || 0 })}
                      className="w-full bg-[#09090b] border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isAdding}
                    className="w-full flex items-center justify-center gap-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold py-2.5 rounded-lg transition-all"
                  >
                    {isAdding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    Add Swatch
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation with Reassignment Modal overlay */}
        {deletingColor && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
            <div className="w-full max-w-md bg-[#09090b] border border-red-500/30 rounded-2xl p-6 shadow-2xl space-y-4">
              <div className="flex items-center gap-2 text-red-400">
                <AlertTriangle className="w-6 h-6 flex-shrink-0" />
                <h3 className="text-base font-bold">Delete Account Color: {deletingColor.meaning}</h3>
              </div>

              {checkingInUse ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-5 h-5 animate-spin text-purple-500" />
                </div>
              ) : inUseAccountCount > 0 ? (
                <div className="space-y-4">
                  <p className="text-xs text-gray-300 leading-relaxed">
                    This color configuration is currently in use by <span className="text-white font-bold">{inUseAccountCount} accounts</span>.
                    To prevent orphaning them, you must reassign these accounts to another color:
                  </p>

                  {colors.filter((c) => c.id !== deletingColor.id).length === 0 ? (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-xs text-red-400 leading-relaxed">
                      You cannot delete this color configuration because it is in use and there are no other active colors to reassign the accounts to.
                      Please create another color configuration first.
                    </div>
                  ) : (
                    <div>
                      <label className="block text-[10px] text-gray-400 mb-1.5 uppercase font-bold">Reassign Accounts To:</label>
                      <select
                        value={reassignToId}
                        onChange={(e) => setReassignToId(e.target.value)}
                        className="w-full bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
                      >
                        {colors
                          .filter((c) => c.id !== deletingColor.id)
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.meaning} ({c.color})
                            </option>
                          ))}
                      </select>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-gray-300">
                  Are you sure you want to delete this color swatch config? No accounts are using it.
                </p>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => setDeletingColor(null)}
                  className="px-4 py-2 text-xs font-semibold bg-white/5 hover:bg-white/10 text-white rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteConfirm}
                  disabled={isDeleting || (inUseAccountCount > 0 && colors.filter((c) => c.id !== deletingColor.id).length === 0)}
                  className="px-4 py-2 text-xs font-semibold bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {isDeleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Confirm Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
