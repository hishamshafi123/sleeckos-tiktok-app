"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { useRouter } from "next/navigation";

export default function ApplicationForm({ campaignId }: { campaignId: string }) {
  const [pitch, setPitch] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleApply = async () => {
    if (!pitch || pitch.length < 20) {
      toast.error("Please write a bit more about how you'll approach this campaign.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pitch }),
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to apply");
      
      toast.success("Application submitted successfully!");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">Your Pitch</label>
        <textarea
          value={pitch}
          onChange={(e) => setPitch(e.target.value)}
          placeholder="How will you create this content? Mention your style and past experience with similar brands..."
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 transition-all text-sm min-h-[120px] resize-none"
        />
        <p className="text-[10px] text-gray-600 mt-2">Brands see your pitch first. Be specific and authentic.</p>
      </div>

      <button
        onClick={handleApply}
        disabled={loading || !pitch}
        className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-bold py-3.5 rounded-xl text-sm transition-all flex items-center justify-center gap-2 group shadow-lg shadow-purple-500/20"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />}
        Submit Application
      </button>
    </div>
  );
}
