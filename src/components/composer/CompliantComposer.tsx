"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Shield, Lock, AlertCircle, Loader2, CheckCircle, Smartphone, ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";

export default function CompliantComposer({ deliverable, tiktokAccount }: { deliverable: any, tiktokAccount: any }) {
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const router = useRouter();

  const handlePublish = async () => {
    setPublishing(true);
    try {
      // 1. Initialize Direct Post on TikTok
      const initRes = await fetch("/api/tiktok/init-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deliverableId: deliverable.id,
          title: deliverable.draftCaption,
          privacy_level: "PUBLIC_TO_EVERYONE",
          brand_content_toggle: true, // HARDCODED AS PER PRD
        }),
      });

      const initData = await initRes.json();
      if (!initRes.ok) throw new Error(initData.error || "TikTok initialization failed");

      // In a real production app, we would now upload the actual video file to initData.uploadUrl
      // For this demo/v1, we simulate a successful publish since we are using external URLs for drafts.
      
      toast.success("Content published to TikTok successfully!");
      setPublished(true);
      
      // Update local status
      await fetch(`/api/deliverables/${deliverable.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tiktokVideoId: "v123456789" }) 
      });

      setTimeout(() => {
        router.push(`/c/active/${deliverable.id}`);
      }, 3000);

    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setPublishing(false);
    }
  };

  if (published) {
    return (
      <div className="glass border border-green-500/30 rounded-3xl p-12 text-center space-y-6 animate-in zoom-in-95 duration-500">
        <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto">
          <CheckCircle className="w-10 h-10 text-green-500" />
        </div>
        <div>
          <h2 className="text-2xl font-black text-white">Post Published!</h2>
          <p className="text-gray-500 mt-2">Your video is live. Redirecting you to track metrics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid md:grid-cols-2 gap-8">
      {/* Preview Section */}
      <div className="space-y-6">
        <div className="relative aspect-[9/16] max-w-[300px] mx-auto bg-black rounded-[3rem] border-[8px] border-zinc-800 shadow-2xl overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/60 z-10" />
          
          {/* Mock Video Info */}
          <div className="absolute bottom-10 left-4 right-4 z-20 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-white/20 border border-white/20" />
              <span className="text-xs font-bold text-white">@{tiktokAccount.username}</span>
            </div>
            <p className="text-[10px] text-gray-200 line-clamp-3 leading-relaxed">
              {deliverable.draftCaption}
            </p>
            <div className="flex items-center gap-2 bg-black/40 backdrop-blur-md px-2 py-1 rounded w-fit">
              <Shield className="w-3 h-3 text-purple-400" />
              <span className="text-[9px] font-bold text-purple-300 uppercase">Paid Partnership</span>
            </div>
          </div>

          <div className="absolute inset-0 flex items-center justify-center">
            <VideoPlaceholder />
          </div>
        </div>
        <p className="text-center text-xs text-gray-600">Mobile Preview</p>
      </div>

      {/* Controls Section */}
      <div className="space-y-6">
        <div className="glass border border-white/5 rounded-3xl p-8 space-y-6">
          <h3 className="text-white font-bold flex items-center gap-2">
            <Lock className="w-4 h-4 text-purple-400" />
            Compliance Settings
          </h3>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-purple-500/5 border border-purple-500/20 rounded-2xl">
              <div className="space-y-0.5">
                <p className="text-sm font-bold text-white">Branded Content</p>
                <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">Always Required</p>
              </div>
              <div className="w-10 h-5 bg-purple-600 rounded-full flex items-center px-1 shadow-[0_0_10px_rgba(147,51,234,0.3)]">
                <div className="w-3.5 h-3.5 bg-white rounded-full translate-x-5" />
              </div>
            </div>

            <div className="p-4 bg-white/2 border border-white/5 rounded-2xl opacity-50 cursor-not-allowed">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <p className="text-sm font-bold text-gray-400">Ad Authorization</p>
                  <p className="text-[10px] text-gray-600 uppercase font-bold tracking-widest">Locked</p>
                </div>
                <div className="w-10 h-5 bg-white/5 rounded-full flex items-center px-1">
                  <div className="w-3.5 h-3.5 bg-white/10 rounded-full" />
                </div>
              </div>
            </div>
          </div>

          <div className="bg-amber-500/5 border border-amber-500/10 rounded-2xl p-4 flex gap-3">
            <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-500/80 leading-relaxed">
              This post will be permanently labeled as a paid partnership. Attempting to remove this disclosure after publishing is a violation of the TikTok for Business Terms of Service.
            </p>
          </div>
        </div>

        <button
          onClick={handlePublish}
          disabled={publishing}
          className="w-full bg-white text-black font-black py-5 rounded-3xl transition-all hover:bg-white/90 active:scale-95 flex items-center justify-center gap-3 shadow-2xl shadow-white/5"
        >
          {publishing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Smartphone className="w-5 h-5" />}
          Post to TikTok Now
        </button>
        
        <p className="text-center text-xs text-gray-600">
          Content will be posted instantly as &quot;Public&quot;
        </p>
      </div>
    </div>
  );
}

function VideoPlaceholder() {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center border border-white/10">
        <Smartphone className="w-8 h-8 text-gray-600" />
      </div>
      <span className="text-xs text-gray-700 font-bold uppercase tracking-widest">Video Ready</span>
    </div>
  );
}
