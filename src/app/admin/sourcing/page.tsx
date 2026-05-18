"use client";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Plus, Loader2, Trash2, ChevronRight, X } from "lucide-react";
import Link from "next/link";

type Niche = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  color: string;
  _count: { sources: number; videos: number; accounts: number };
};

export default function SourcingPage() {
  const [niches, setNiches] = useState<Niche[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", color: "#ef4444" });
  const [adding, setAdding] = useState(false);

  const COLORS = ["#ef4444","#f97316","#eab308","#22c55e","#06b6d4","#8b5cf6","#ec4899","#64748b"];

  const fetchNiches = useCallback(async () => {
    const res = await fetch("/api/sourcing/niches");
    if (res.ok) setNiches(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { fetchNiches(); }, [fetchNiches]);

  const addNiche = async () => {
    if (!form.name.trim()) { toast.error("Name required"); return; }
    setAdding(true);
    try {
      const res = await fetch("/api/sourcing/niches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Created: ${data.name}`);
      setForm({ name: "", description: "", color: "#ef4444" });
      setShowAdd(false);
      fetchNiches();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
    finally { setAdding(false); }
  };

  const deleteNiche = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}" and all its sources + videos?`)) return;
    await fetch(`/api/sourcing/niches/${id}`, { method: "DELETE" });
    toast.success(`Deleted: ${name}`);
    fetchNiches();
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 text-red-400 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-red-500" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
            </div>
            Video Sourcing
          </h1>
          <p className="text-gray-500 mt-1 text-sm">{niches.length} sub-niches · each has accounts + YouTube channels</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-all">
          <Plus className="w-4 h-4" /> New Sub-niche
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="glass border border-red-500/20 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-white">Create Sub-niche</h3>
            <button onClick={() => setShowAdd(false)}><X className="w-4 h-4 text-gray-500 hover:text-white" /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Name *</label>
              <input value={form.name} onChange={e => setForm({...form, name: e.target.value})}
                placeholder="e.g. Trump News, War Updates..."
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-600 text-sm focus:outline-none focus:border-red-500"
                onKeyDown={e => e.key === "Enter" && addNiche()} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Description</label>
              <input value={form.description} onChange={e => setForm({...form, description: e.target.value})}
                placeholder="Optional"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-600 text-sm focus:outline-none focus:border-red-500" />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-2 block">Color</label>
            <div className="flex gap-2">
              {COLORS.map(c => (
                <button key={c} onClick={() => setForm({...form, color: c})}
                  className={`w-7 h-7 rounded-full transition-all ${form.color === c ? "ring-2 ring-white ring-offset-2 ring-offset-[#0a0a0f] scale-110" : ""}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={addNiche} disabled={adding || !form.name.trim()}
              className="bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-all flex items-center gap-2">
              {adding && <Loader2 className="w-4 h-4 animate-spin" />} Create Sub-niche
            </button>
            <button onClick={() => setShowAdd(false)} className="text-gray-500 hover:text-white px-4 py-2.5 text-sm">Cancel</button>
          </div>
        </div>
      )}

      {/* Niches grid */}
      {niches.length === 0 ? (
        <div className="glass border border-white/5 rounded-2xl p-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-500" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
          </div>
          <h3 className="text-xl font-bold text-white mb-2">No sub-niches yet</h3>
          <p className="text-gray-500 text-sm mb-6">Create a sub-niche, assign TikTok accounts, and add YouTube channels to source from</p>
          <button onClick={() => setShowAdd(true)} className="bg-red-600 hover:bg-red-500 text-white text-sm font-semibold px-6 py-3 rounded-xl transition-all inline-flex items-center gap-2">
            <Plus className="w-4 h-4" /> Create First Sub-niche
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {niches.map(n => (
            <div key={n.id} className="glass border border-white/5 rounded-2xl overflow-hidden hover:border-white/10 transition-all group">
              <div className="h-1.5" style={{ backgroundColor: n.color }} />
              <div className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-bold text-white text-lg">{n.name}</h3>
                    {n.description && <p className="text-xs text-gray-500 mt-0.5">{n.description}</p>}
                  </div>
                  <button onClick={() => deleteNiche(n.id, n.name)}
                    className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex gap-4 text-sm mb-4">
                  <div className="text-center">
                    <p className="text-white font-bold text-xl">{n._count.accounts}</p>
                    <p className="text-gray-600 text-xs">accounts</p>
                  </div>
                  <div className="text-center">
                    <p className="font-bold text-xl" style={{ color: n.color }}>{n._count.sources}</p>
                    <p className="text-gray-600 text-xs">channels</p>
                  </div>
                  <div className="text-center">
                    <p className="text-white font-bold text-xl">{n._count.videos}</p>
                    <p className="text-gray-600 text-xs">videos</p>
                  </div>
                </div>
                <Link href={`/admin/sourcing/${n.id}`}
                  className="flex items-center justify-center gap-2 w-full py-2 rounded-xl text-sm font-semibold transition-all border"
                  style={{ borderColor: `${n.color}40`, color: n.color, backgroundColor: `${n.color}10` }}>
                  Manage <ChevronRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
