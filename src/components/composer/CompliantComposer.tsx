"use client";
import { useState } from "react";
import { toast } from "sonner";
import {
  Shield, Lock, AlertCircle, Loader2, CheckCircle,
  Smartphone, Send, Inbox, Info,
} from "lucide-react";
import { useRouter } from "next/navigation";

type PostMode = "DIRECT" | "DRAFT";

export default function CompliantComposer({
  deliverable,
  tiktokAccount,
}: {
  deliverable: any;
  tiktokAccount: any;
}) {
  const [mode, setMode] = useState<PostMode>("DIRECT");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<PostMode | null>(null);
  const router = useRouter();

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/tiktok/init-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deliverableId: deliverable.id,
          postType: mode,
          title: deliverable.draftCaption,
          privacy_level: "PUBLIC_TO_EVERYONE",
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "TikTok request failed");

      if (mode === "DIRECT") {
        toast.success("Published to TikTok successfully!");
      } else {
        toast.success("Draft sent to your TikTok inbox!");
      }
      setDone(mode);

      setTimeout(() => router.push(`/c/active/${deliverable.id}`), 3000);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  /* ── Success screens ── */
  if (done === "DIRECT") {
    return (
      <div className="glass border border-green-500/30 rounded-3xl p-12 text-center space-y-6 animate-in zoom-in-95 duration-500">
        <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto">
          <CheckCircle className="w-10 h-10 text-green-500" />
        </div>
        <div>
          <h2 className="text-2xl font-black text-white">Post Published!</h2>
          <p className="text-gray-500 mt-2">Your video is live on TikTok. Redirecting to track metrics…</p>
        </div>
      </div>
    );
  }

  if (done === "DRAFT") {
    return (
      <div className="glass border border-blue-500/30 rounded-3xl p-12 text-center space-y-6 animate-in zoom-in-95 duration-500">
        <div className="w-20 h-20 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto">
          <Inbox className="w-10 h-10 text-blue-400" />
        </div>
        <div>
          <h2 className="text-2xl font-black text-white">Draft Sent to Inbox!</h2>
          <p className="text-gray-500 mt-2">
            Open TikTok on your phone, go to <strong className="text-white">Me → Drafts</strong> to review and publish from the app.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid md:grid-cols-2 gap-8">
      {/* Preview Section */}
      <div className="space-y-6">
        <div className="relative aspect-[9/16] max-w-[300px] mx-auto bg-black rounded-[3rem] border-[8px] border-zinc-800 shadow-2xl overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/60 z-10" />
          <div className="absolute bottom-10 left-4 right-4 z-20 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-white/20 border border-white/20" />
              <span className="text-xs font-bold text-white">@{tiktokAccount.username}</span>
            </div>
            <p className="text-[10px] text-gray-200 line-clamp-3 leading-relaxed">
              {deliverable.draftCaption}
            </p>
            {mode === "DIRECT" && (
              <div className="flex items-center gap-2 bg-black/40 backdrop-blur-md px-2 py-1 rounded w-fit">
                <Shield className="w-3 h-3 text-purple-400" />
                <span className="text-[9px] font-bold text-purple-300 uppercase">Paid Partnership</span>
              </div>
            )}
          </div>
          <div className="absolute inset-0 flex items-center justify-center">
            <VideoPlaceholder />
          </div>
        </div>
        <p className="text-center text-xs text-gray-600">Mobile Preview</p>
      </div>

      {/* Controls Section */}
      <div className="space-y-6">

        {/* Mode Selector */}
        <div className="glass border border-white/10 rounded-3xl p-2 flex gap-2">
          <button
            onClick={() => setMode("DIRECT")}
            className={`flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-semibold transition-all ${
              mode === "DIRECT"
                ? "bg-white text-black shadow-lg"
                : "text-gray-500 hover:text-white"
            }`}
          >
            <Send className="w-4 h-4" />
            Publish Now
          </button>
          <button
            onClick={() => setMode("DRAFT")}
            className={`flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-semibold transition-all ${
              mode === "DRAFT"
                ? "bg-blue-600 text-white shadow-lg shadow-blue-500/20"
                : "text-gray-500 hover:text-white"
            }`}
          >
            <Inbox className="w-4 h-4" />
            Save as Draft
          </button>
        </div>

        {/* Mode description */}
        {mode === "DIRECT" ? (
          <div className="bg-white/3 border border-white/5 rounded-2xl p-4 flex gap-3 text-xs text-gray-400 leading-relaxed">
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-gray-500" />
            Posts immediately to TikTok as <strong className="text-white">Public</strong> with
            the mandatory <strong className="text-purple-300">Paid Partnership</strong> label locked on.
            You cannot remove the disclosure after publishing.
          </div>
        ) : (
          <div className="bg-blue-500/5 border border-blue-500/15 rounded-2xl p-4 flex gap-3 text-xs text-blue-300/80 leading-relaxed">
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-blue-400" />
            Sends the video to your <strong className="text-white">TikTok drafts inbox</strong>.
            You can then open TikTok on your phone, make final edits, add sounds, and publish whenever you're ready.
            <br /><br />
            <span className="text-amber-400">⚠ Note:</span> You must manually add the Paid Partnership label inside TikTok before publishing.
          </div>
        )}

        {/* Compliance Settings (only shown in direct mode) */}
        {mode === "DIRECT" && (
          <div className="glass border border-white/5 rounded-3xl p-6 space-y-4">
            <h3 className="text-white font-bold flex items-center gap-2 text-sm">
              <Lock className="w-4 h-4 text-purple-400" />
              Compliance Settings
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-4 bg-purple-500/5 border border-purple-500/20 rounded-2xl">
                <div>
                  <p className="text-sm font-bold text-white">Branded Content</p>
                  <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">Always Required</p>
                </div>
                <div className="w-10 h-5 bg-purple-600 rounded-full flex items-center px-1 shadow-[0_0_10px_rgba(147,51,234,0.3)]">
                  <div className="w-3.5 h-3.5 bg-white rounded-full translate-x-5" />
                </div>
              </div>
              <div className="p-4 bg-white/2 border border-white/5 rounded-2xl opacity-50 cursor-not-allowed">
                <div className="flex items-center justify-between">
                  <div>
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
                This post will be permanently labeled as a paid partnership. Removing this disclosure after publishing violates TikTok for Business Terms of Service.
              </p>
            </div>
          </div>
        )}

        {/* CTA */}
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className={`w-full font-black py-5 rounded-3xl transition-all active:scale-95 flex items-center justify-center gap-3 shadow-2xl ${
            mode === "DIRECT"
              ? "bg-white text-black hover:bg-white/90 shadow-white/5"
              : "bg-blue-600 text-white hover:bg-blue-500 shadow-blue-500/20"
          }`}
        >
          {submitting ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : mode === "DIRECT" ? (
            <><Send className="w-5 h-5" /> Post to TikTok Now</>
          ) : (
            <><Inbox className="w-5 h-5" /> Send to TikTok Drafts</>
          )}
        </button>

        <p className="text-center text-xs text-gray-600">
          {mode === "DIRECT"
            ? "Content will be posted instantly as \u201cPublic\u201d"
            : "Video will appear in your TikTok app under Me \u2192 Drafts"}
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
