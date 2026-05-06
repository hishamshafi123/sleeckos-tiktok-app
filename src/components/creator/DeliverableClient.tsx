"use client";
import { useState } from "react";
import { toast } from "sonner";
import {
  Upload, Send, Loader2, Video, CheckCircle, Lock, Shield,
  AlertCircle, Smartphone, Play, ExternalLink, RefreshCw
} from "lucide-react";
import { useRouter } from "next/navigation";

interface Props {
  deliverable: any;
  tiktokAccount: any;
}

export default function CreatorDeliverableClient({ deliverable, tiktokAccount }: Props) {
  const router = useRouter();

  // ---------- State ----------
  const [videoUrl, setVideoUrl] = useState(deliverable.draftVideoUrl ?? "");
  const [caption, setCaption] = useState(deliverable.draftCaption ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [postMode, setPostMode] = useState<"DIRECT" | "DRAFT">("DIRECT");

  // ---------- Submit Draft ----------
  const handleSubmitDraft = async () => {
    if (!videoUrl || !caption) { toast.error("Video URL and caption are required."); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/deliverables/${deliverable.id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl, caption }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      toast.success("Draft submitted! Waiting for brand review.");
      router.refresh();
    } catch (e: any) { toast.error(e.message); }
    finally { setSubmitting(false); }
  };

  // ---------- Publish / Draft to TikTok ----------
  const handlePublish = async () => {
    setPublishing(true);
    try {
      const initRes = await fetch("/api/tiktok/init-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deliverableId: deliverable.id,
          postType: postMode,
          title: caption,
          privacy_level: "PUBLIC_TO_EVERYONE",
          brand_content_toggle: true, // always locked on for direct posts
        }),
      });
      const initData = await initRes.json();
      if (!initRes.ok) throw new Error(initData.error ?? "TikTok request failed");

      if (postMode === "DRAFT") {
        toast.success("Draft sent to your TikTok inbox! Open TikTok → Me → Drafts to publish.");
        router.refresh();
      } else {
        // Mark as published in our DB
        const completeRes = await fetch(`/api/deliverables/${deliverable.id}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tiktokVideoId: initData.publish_id ?? "pending" }),
        });
        if (!completeRes.ok) throw new Error("Failed to mark published");
        toast.success("🎉 Published to TikTok with Branded Content disclosure!");
        router.refresh();
      }
    } catch (e: any) { toast.error(e.message); }
    finally { setPublishing(false); }
  };

  // ---------- Refresh Metrics ----------
  const handleRefreshMetrics = async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/deliverables/${deliverable.id}/metrics`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to refresh metrics");
      toast.success("Metrics updated!");
      router.refresh();
    } catch (e: any) { toast.error(e.message); }
    finally { setRefreshing(false); }
  };

  // =================== RENDER STATES ===================

  // PUBLISHED STATE
  if (deliverable.status === "PUBLISHED") {
    return (
      <div className="glass border border-purple-500/20 rounded-3xl overflow-hidden">
        <div className="border-b border-white/5 px-8 py-5 flex items-center justify-between">
          <div className="flex items-center gap-2 text-white font-bold">
            <CheckCircle className="w-5 h-5 text-green-400" />
            Live on TikTok
          </div>
          <button
            onClick={handleRefreshMetrics}
            disabled={refreshing}
            className="flex items-center gap-2 text-xs text-gray-500 hover:text-white bg-white/5 px-3 py-1.5 rounded-lg transition-all"
          >
            <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
            Refresh Metrics
          </button>
        </div>
        <div className="p-8 space-y-6">
          <div className="bg-green-500/5 border border-green-500/10 rounded-2xl p-5 text-center">
            <p className="text-sm text-gray-400 mb-2">Your content is live with</p>
            <div className="inline-flex items-center gap-2 bg-purple-500/10 border border-purple-500/20 px-4 py-2 rounded-xl">
              <Shield className="w-4 h-4 text-purple-400" />
              <span className="text-purple-300 text-sm font-bold">Paid Partnership Disclosure</span>
            </div>
          </div>
          {deliverable.tiktokPostUrl && (
            <a
              href={deliverable.tiktokPostUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full bg-white/5 hover:bg-white/10 border border-white/10 text-white py-3 rounded-2xl text-sm transition-all"
            >
              View on TikTok <ExternalLink className="w-4 h-4" />
            </a>
          )}
        </div>
      </div>
    );
  }

  // APPROVED STATE — Publish Now or Save as Draft
  if (deliverable.status === "DRAFT_APPROVED" || deliverable.status === "READY_TO_PUBLISH") {
    return (
      <div className="glass border border-green-500/20 rounded-3xl overflow-hidden">
        <div className="border-b border-white/5 px-8 py-5 flex items-center gap-2">
          <CheckCircle className="w-5 h-5 text-green-400" />
          <span className="text-white font-bold">Draft Approved — Ready to Post</span>
        </div>
        <div className="p-8 space-y-6">

          {/* Mode toggle */}
          <div className="grid grid-cols-2 gap-2 p-1 bg-white/5 rounded-2xl border border-white/10">
            <button
              type="button"
              onClick={() => setPostMode("DIRECT")}
              className={`py-3.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${
                postMode === "DIRECT"
                  ? "bg-white text-black shadow-lg"
                  : "text-gray-500 hover:text-white"
              }`}
            >
              <Smartphone className="w-4 h-4" />
              Publish Now
            </button>
            <button
              type="button"
              onClick={() => setPostMode("DRAFT")}
              className={`py-3.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${
                postMode === "DRAFT"
                  ? "bg-blue-600 text-white shadow-lg shadow-blue-500/20"
                  : "text-gray-500 hover:text-white"
              }`}
            >
              <Play className="w-4 h-4" />
              Save as Draft
            </button>
          </div>

          {/* Mode description */}
          {postMode === "DIRECT" ? (
            <div className="space-y-4">
              <div className="bg-green-500/5 border border-green-500/10 rounded-2xl p-5">
                <p className="text-sm text-gray-300 mb-3">The brand has approved your content. Posting will go live immediately with the <strong className="text-purple-300">Branded Content</strong> label locked on.</p>
                <div className="flex items-start gap-3 bg-amber-500/5 border border-amber-500/10 rounded-xl p-4">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-400/80 leading-relaxed">This post will be permanently labeled as a Paid Partnership. Removing the disclosure after posting violates TikTok Terms of Service.</p>
                </div>
              </div>
              {/* Compliance toggle (locked on) */}
              <div className="flex items-center justify-between bg-purple-500/5 border border-purple-500/20 rounded-2xl p-5">
                <div className="flex items-center gap-3">
                  <Lock className="w-4 h-4 text-purple-400" />
                  <div>
                    <p className="text-sm font-bold text-white">Branded Content Disclosure</p>
                    <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">Always Required</p>
                  </div>
                </div>
                <div className="w-10 h-5 bg-purple-600 rounded-full flex items-center px-0.5 shadow-[0_0_12px_rgba(147,51,234,0.4)]">
                  <div className="w-4 h-4 bg-white rounded-full translate-x-5" />
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-blue-500/5 border border-blue-500/15 rounded-2xl p-5 text-sm text-blue-300/80 leading-relaxed">
              Your video will be sent to your <strong className="text-white">TikTok drafts inbox</strong>. Open TikTok on your phone, go to <strong className="text-white">Me → Drafts</strong>, make any final edits, and publish when you&apos;re ready.
              <div className="mt-3 text-xs text-amber-400">
                ⚠ You must manually enable the Paid Partnership label inside TikTok before publishing the draft.
              </div>
            </div>
          )}

          <button
            onClick={handlePublish}
            disabled={publishing || !tiktokAccount}
            className={`w-full font-black py-5 rounded-2xl transition-all active:scale-95 flex items-center justify-center gap-3 shadow-xl disabled:opacity-40 ${
              postMode === "DRAFT"
                ? "bg-blue-600 hover:bg-blue-500 text-white shadow-blue-500/20"
                : "bg-white text-black hover:bg-white/90 shadow-white/5"
            }`}
          >
            {publishing ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : postMode === "DRAFT" ? (
              <><Play className="w-5 h-5" /> Send to TikTok Drafts</>
            ) : (
              <><Smartphone className="w-5 h-5" /> Post to TikTok Now</>
            )}
          </button>

          {!tiktokAccount && (
            <p className="text-center text-xs text-red-400">You need to connect your TikTok account first.</p>
          )}
        </div>
      </div>
    );
  }

  // UNDER REVIEW STATE
  if (deliverable.status === "DRAFT_UPLOADED") {
    return (
      <div className="glass border border-yellow-500/20 rounded-3xl p-8 text-center space-y-4">
        <div className="w-16 h-16 bg-yellow-500/10 rounded-full flex items-center justify-center mx-auto">
          <Loader2 className="w-8 h-8 text-yellow-500" />
        </div>
        <h3 className="text-white font-bold text-lg">Under Brand Review</h3>
        <p className="text-gray-400 text-sm max-w-sm mx-auto">Your draft has been submitted and the brand is reviewing it. You'll be notified when there's an update.</p>
        <div className="mt-4 text-left bg-white/5 rounded-2xl p-4 space-y-2">
          <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">Submitted Caption</p>
          <p className="text-xs text-gray-300 leading-relaxed">{deliverable.draftCaption}</p>
        </div>
        {deliverable.draftVideoUrl && (
          <a href={deliverable.draftVideoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-purple-400 text-sm hover:underline">
            View your submitted draft <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    );
  }

  // UPLOAD STATE (BRIEFED / DRAFT_NEEDS_CHANGES)
  return (
    <div className="glass border border-white/5 rounded-3xl overflow-hidden">
      <div className="border-b border-white/5 px-8 py-5">
        <div className="flex items-center gap-2 text-white font-bold">
          <Upload className="w-5 h-5 text-purple-400" />
          {deliverable.status === "DRAFT_NEEDS_CHANGES" ? "Upload Revised Draft" : "Submit Your Content"}
        </div>
        {deliverable.status === "DRAFT_NEEDS_CHANGES" && (
          <p className="text-xs text-orange-400 mt-1">The brand has requested changes. Please review their feedback and resubmit.</p>
        )}
      </div>

      <div className="p-8 space-y-5">
        <div>
          <label className="block text-[10px] text-gray-500 uppercase font-bold tracking-widest mb-2">
            Video Link (Google Drive, Dropbox, or Loom)
          </label>
          <div className="relative">
            <Video className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
            <input
              type="url"
              value={videoUrl}
              onChange={e => setVideoUrl(e.target.value)}
              placeholder="https://drive.google.com/file/..."
              className="w-full bg-white/5 border border-white/10 rounded-xl pl-12 pr-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 transition-all text-sm"
            />
          </div>
          <p className="text-[10px] text-gray-600 mt-1.5">Make sure the link is publicly accessible or shared with anyone.</p>
        </div>

        <div>
          <label className="block text-[10px] text-gray-500 uppercase font-bold tracking-widest mb-2">
            Caption (include required hashtags)
          </label>
          <textarea
            value={caption}
            onChange={e => setCaption(e.target.value)}
            placeholder="Write your TikTok caption here..."
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 transition-all text-sm resize-none"
            rows={4}
          />
          <div className="flex flex-wrap gap-1 mt-2">
            {deliverable.campaign.requiredHashtags.map((tag: string) => (
              <button
                key={tag}
                onClick={() => setCaption((c: string) => c + (c.endsWith(' ') || c === '' ? '' : ' ') + `#${tag}`)}
                className="text-[10px] text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded hover:bg-purple-500/20 transition-all"
              >
                + #{tag}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={handleSubmitDraft}
          disabled={submitting || !videoUrl || !caption}
          className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-bold py-4 rounded-xl text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-purple-500/10"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Submit for Brand Review
        </button>
      </div>
    </div>
  );
}
