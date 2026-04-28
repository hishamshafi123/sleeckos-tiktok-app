"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Upload, Video, Send } from "lucide-react";
import { useRouter } from "next/navigation";

export default function DeliverableSubmissionForm({ deliverable }: { deliverable: any }) {
  const [videoUrl, setVideoUrl] = useState(deliverable.draftVideoUrl || "");
  const [caption, setCaption] = useState(deliverable.draftCaption || "");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmitDraft = async () => {
    if (!videoUrl || !caption) {
      toast.error("Please provide both a video URL and your proposed caption.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/deliverables/${deliverable.id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl, caption }),
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to submit draft");
      }
      
      toast.success("Draft submitted for brand review!");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-purple-500/5 border border-purple-500/10 rounded-2xl p-6">
        <h3 className="text-white font-bold text-sm mb-4 flex items-center gap-2">
          <Upload className="w-4 h-4 text-purple-400" />
          Submit your draft
        </h3>
        
        <div className="space-y-4">
          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Video Link (Gdrive/Dropbox/Loom)</label>
            <div className="relative">
              <Video className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
              <input
                type="url"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="https://drive.google.com/..."
                className="w-full bg-white/5 border border-white/10 rounded-xl pl-12 pr-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 transition-all text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Draft Caption</label>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Write your TikTok caption here. Include required hashtags and mentions."
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 transition-all text-sm min-h-[100px] resize-none"
            />
          </div>

          <button
            onClick={handleSubmitDraft}
            disabled={loading || !videoUrl || !caption}
            className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-bold py-4 rounded-xl text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-purple-500/10"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Submit for Review
          </button>
        </div>
      </div>
      
      <p className="text-xs text-gray-600 text-center px-4 leading-relaxed">
        The brand will review your draft and caption. You will be able to publish to TikTok once they approve the content.
      </p>
    </div>
  );
}
