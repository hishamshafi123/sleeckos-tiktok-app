"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Check, X, Loader2, ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";

export default function BrandApplicationCard({ application }: { application: any }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const updateAppStatus = async (status: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/brands/applications/${application.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      toast.success(`Application ${status.toLowerCase()}`);
      router.refresh();
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  const approveDraft = async () => {
    if (!application.deliverable) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/brands/deliverables/${application.deliverable.id}/approve`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to approve draft");
      toast.success("Draft approved — creator can now publish!");
      router.refresh();
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  const requestChanges = async (feedback: string) => {
    if (!application.deliverable || !feedback) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/brands/deliverables/${application.deliverable.id}/request-changes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback }),
      });
      if (!res.ok) throw new Error("Failed to request changes");
      toast.success("Feedback sent to creator");
      router.refresh();
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  const d = application.deliverable;
  const status = application.status;

  // Pitch display
  const pitch = (
    <p className="text-xs text-gray-400 italic mb-3">"{application.pitch}"</p>
  );

  if (status === "SUBMITTED") {
    return (
      <div>
        {pitch}
        <div className="flex gap-2">
          <button onClick={() => updateAppStatus("ACCEPTED")} disabled={loading}
            className="flex-1 bg-green-600 hover:bg-green-500 text-white font-bold py-2 rounded-lg text-xs transition-all flex items-center justify-center gap-1">
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
            Approve Creator
          </button>
          <button onClick={() => updateAppStatus("REJECTED")} disabled={loading}
            className="flex-1 bg-red-600/10 hover:bg-red-600/20 text-red-400 font-bold py-2 rounded-lg text-xs border border-red-600/20 transition-all flex items-center justify-center gap-1">
            <X className="w-3 h-3" /> Reject
          </button>
        </div>
      </div>
    );
  }

  if (status === "ACCEPTED" && !d) {
    return <p className="text-[10px] text-gray-600 text-center py-2">Creator accepted · Waiting for draft submission...</p>;
  }

  if (d?.status === "DRAFT_UPLOADED") {
    return (
      <div className="space-y-2">
        <FeedbackButton onSubmit={requestChanges} loading={loading} />
        <button onClick={approveDraft} disabled={loading}
          className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-2 rounded-lg text-xs transition-all flex items-center justify-center gap-2">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
          Approve Draft for Publishing
        </button>
      </div>
    );
  }

  if (d?.status === "DRAFT_NEEDS_CHANGES") {
    return <p className="text-[10px] text-orange-400 text-center py-2">Feedback sent · Waiting for revision...</p>;
  }

  if (d?.status === "DRAFT_APPROVED" || d?.status === "READY_TO_PUBLISH") {
    return <p className="text-[10px] text-green-400 text-center py-2">✓ Draft approved · Creator is publishing...</p>;
  }

  if (d?.status === "PUBLISHED") {
    return (
      <p className="text-[10px] text-purple-300 text-center py-2 flex items-center justify-center gap-1">
        <Check className="w-3 h-3" /> Published & Tracking Metrics
      </p>
    );
  }

  if (status === "REJECTED") {
    return <p className="text-[10px] text-gray-600 text-center py-2">Application rejected.</p>;
  }

  return null;
}

function FeedbackButton({ onSubmit, loading }: { onSubmit: (f: string) => void; loading: boolean }) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState("");

  if (!open) return (
    <button onClick={() => setOpen(true)}
      className="w-full bg-white/5 hover:bg-white/10 text-gray-400 font-bold py-2 rounded-lg text-xs border border-white/10 transition-all">
      Request Changes
    </button>
  );

  return (
    <div className="space-y-2">
      <textarea
        value={feedback}
        onChange={e => setFeedback(e.target.value)}
        placeholder="What needs to be changed?"
        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-xs resize-none focus:outline-none focus:border-orange-500"
        rows={2}
      />
      <div className="flex gap-2">
        <button onClick={() => setOpen(false)} className="flex-1 text-gray-500 text-xs py-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-all">Cancel</button>
        <button onClick={() => { onSubmit(feedback); setOpen(false); setFeedback(""); }} disabled={!feedback || loading}
          className="flex-1 bg-orange-600 hover:bg-orange-500 text-white font-bold text-xs py-1.5 rounded-lg transition-all">
          Send Feedback
        </button>
      </div>
    </div>
  );
}
