"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Check, X, Loader2, ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";

export default function AdminApplicationCard({ application }: { application: any }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const updateStatus = async (newStatus: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/applications/${application.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update status");
      }
      
      toast.success(`Application ${newStatus.toLowerCase()}!`);
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass border border-white/5 rounded-2xl p-6 flex flex-col md:flex-row gap-6 items-start">
      <div className="flex-1 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-white font-bold">{application.creatorUser.creatorProfile?.displayName || application.creatorUser.email}</h3>
            <p className="text-xs text-gray-500 uppercase tracking-widest mt-1">
              Applied for: <span className="text-purple-400">{application.campaign.title}</span>
            </p>
          </div>
          <span className={`text-[10px] font-bold px-2 py-1 rounded ${
            application.status === "ACCEPTED" ? "bg-green-500/10 text-green-400" : 
            application.status === "REJECTED" ? "bg-red-500/10 text-red-400" : "bg-white/5 text-gray-400"
          }`}>
            {application.status}
          </span>
        </div>

        <div className="bg-white/2 rounded-xl p-4 text-sm text-gray-400 italic">
          &quot;{application.pitch}&quot;
        </div>
      </div>

      <div className="w-full md:w-48 flex flex-col gap-2">
        {application.status === "SUBMITTED" && (
          <>
            <button
              onClick={() => updateStatus("ACCEPTED")}
              disabled={loading}
              className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-2 rounded-lg text-xs transition-all flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              Approve Creator
            </button>
            <button
              onClick={() => updateStatus("REJECTED")}
              disabled={loading}
              className="w-full bg-red-600/10 hover:bg-red-600/20 text-red-400 font-bold py-2 rounded-lg text-xs transition-all flex items-center justify-center gap-2 border border-red-600/20"
            >
              <X className="w-3 h-3" />
              Reject
            </button>
          </>
        )}
        
        {application.status === "ACCEPTED" && !application.deliverable && (
          <p className="text-[10px] text-gray-600 text-center">Waiting for creator to submit draft...</p>
        )}

        {application.deliverable && (
          <div className="space-y-2">
            <p className="text-[10px] text-purple-400 font-bold uppercase tracking-widest mb-1">Deliverable Sent</p>
            <a 
              href={application.deliverable.draftVideoUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              className="w-full bg-white/5 hover:bg-white/10 text-white py-2 rounded-lg text-xs transition-all flex items-center justify-center gap-2 border border-white/10"
            >
              View Draft <ExternalLink className="w-3 h-3" />
            </a>
            {application.deliverable.status === "DRAFT_UPLOADED" && (
              <button
                onClick={async () => {
                  setLoading(true);
                  await fetch(`/api/admin/deliverables/${application.deliverable.id}/approve`, { method: "POST" });
                  toast.success("Draft approved for publishing!");
                  router.refresh();
                  setLoading(false);
                }}
                className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-2 rounded-lg text-xs transition-all"
              >
                Approve for Publishing
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
