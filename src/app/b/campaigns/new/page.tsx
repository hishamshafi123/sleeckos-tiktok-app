"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Megaphone } from "lucide-react";
import Link from "next/link";

export default function NewCampaignPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    brief: "",
    payoutPerPostCents: 100,
    maxCreators: 1,
    requiredHashtags: "",
    requiredMentions: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch("/api/brands/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          payoutPerPostCents: form.payoutPerPostCents * 100, // Convert dollars to cents
          requiredHashtags: form.requiredHashtags.split(",").map(s => s.trim()).filter(Boolean),
          requiredMentions: form.requiredMentions.split(",").map(s => s.trim()).filter(Boolean),
          applicationDeadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // 14 days from now
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create campaign");
      }

      toast.success("Campaign created successfully!");
      router.push("/b/campaigns");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8 pb-20">
      <Link href="/b/campaigns" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-white transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Back to campaigns
      </Link>

      <div>
        <h1 className="text-3xl font-black text-white mb-2">Post a New Campaign</h1>
        <p className="text-gray-500">Create a detailed brief to find the best creators for your brand.</p>
      </div>

      <form onSubmit={handleSubmit} className="glass border border-white/5 rounded-3xl p-8 space-y-6">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Campaign Title</label>
            <input
              type="text"
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-purple-500 transition-all text-sm"
              placeholder="e.g. Summer Skincare Routine"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Short Description</label>
            <textarea
              required
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-purple-500 transition-all text-sm resize-none"
              placeholder="Briefly describe what this campaign is about..."
              rows={2}
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">The Brief (Detailed)</label>
            <textarea
              required
              value={form.brief}
              onChange={(e) => setForm({ ...form, brief: e.target.value })}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-purple-500 transition-all text-sm resize-none"
              placeholder="What exactly should the creator do? What are the key talking points?"
              rows={5}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Payout per post ($)</label>
              <input
                type="number"
                min="1"
                required
                value={form.payoutPerPostCents}
                onChange={(e) => setForm({ ...form, payoutPerPostCents: parseInt(e.target.value) || 0 })}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-purple-500 transition-all text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Max Creators</label>
              <input
                type="number"
                min="1"
                required
                value={form.maxCreators}
                onChange={(e) => setForm({ ...form, maxCreators: parseInt(e.target.value) || 1 })}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-purple-500 transition-all text-sm"
              />
            </div>
          </div>

          <div>
             <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Required Hashtags (comma separated)</label>
             <input
               type="text"
               value={form.requiredHashtags}
               onChange={(e) => setForm({ ...form, requiredHashtags: e.target.value })}
               className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-purple-500 transition-all text-sm"
               placeholder="ad, sponsored, brandname"
             />
          </div>
          
          <div>
             <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Required Mentions (comma separated)</label>
             <input
               type="text"
               value={form.requiredMentions}
               onChange={(e) => setForm({ ...form, requiredMentions: e.target.value })}
               className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-purple-500 transition-all text-sm"
               placeholder="brandaccount, partner"
             />
          </div>

        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-bold py-4 rounded-xl text-sm transition-all flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Megaphone className="w-4 h-4" />}
          Post Campaign
        </button>
      </form>
    </div>
  );
}
