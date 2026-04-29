"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Check, X, Loader2, ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";

export default function BrandApplicationCard({ application }: { application: any }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const updateStatus = async (newStatus: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/brands/applications/${application.id}/status`, {
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
    <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-bold text-white">{application.creatorUser.creatorProfile?.displayName || application.creatorUser.email}</h3>
          <span className={`text-[10px] font-bold px-2 py-1 rounded inline-block mt-1 ${
            application.status === 'ACCEPTED' ? 'bg-green-500/10 text-green-400' : 
            application.status === 'REJECTED' ? 'bg-red-500/10 text-red-400' : 'bg-gray-500/10 text-gray-400'
          }`}>{application.status}</span>
        </div>
      </div>
      
      <div className="bg-white/2 rounded-lg p-3 text-xs text-gray-400 italic">
        &quot;{application.pitch}&quot;
      </div>

      <div className="w-full flex flex-col gap-2">
        {application.status === "SUBMITTED" && (
          <div className="flex gap-2">
            <button
              onClick={() => updateStatus("ACCEPTED")}
              disabled={loading}
              className="flex-1 bg-green-600 hover:bg-green-500 text-white font-bold py-2 rounded-lg text-xs transition-all flex items-center justify-center gap-1"
            >
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              Approve
            </button>
            <button
              onClick={() => updateStatus("REJECTED")}
              disabled={loading}
              className="flex-1 bg-red-600/10 hover:bg-red-600/20 text-red-400 font-bold py-2 rounded-lg text-xs transition-all flex items-center justify-center gap-1 border border-red-600/20"
            >
              <X className="w-3 h-3" />
              Reject
            </button>
          </div>
        )}
        
        {application.status === "ACCEPTED" && !application.deliverable && (
          <p className="text-[10px] text-gray-600 text-center">Waiting for creator to submit draft...</p>
        )}

        {application.deliverable && (
          <div className="space-y-2 mt-2 pt-2 border-t border-white/10">
            <p className="text-[10px] text-purple-400 font-bold uppercase tracking-widest mb-1 flex justify-between">
              <span>Deliverable</span>
              <span>{application.deliverable.status.replace(/_/g, ' ')}</span>
            </p>
            {application.deliverable.draftVideoUrl && (
              <a 
                href={application.deliverable.draftVideoUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                className="w-full bg-white/5 hover:bg-white/10 text-white py-2 rounded-lg text-xs transition-all flex items-center justify-center gap-2 border border-white/10"
              >
                View Draft <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {application.deliverable.status === "DRAFT_UPLOADED" && (
              <button
                onClick={async () => {
                  setLoading(true);
                  try {
                    const res = await fetch(`/api/brands/deliverables/${application.deliverable.id}/approve`, { method: "POST" });
                    if (!res.ok) throw new Error("Failed to approve draft");
                    toast.success("Draft approved for publishing!");
                    router.refresh();
                  } catch (err: any) {
                    toast.error(err.message);
                  }
                  setLoading(false);
                }}
                className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-2 rounded-lg text-xs transition-all flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                Approve Draft
              </button>
            )}
            {application.deliverable.status === "PUBLISHED" && (
              <a 
                href={`/b/campaigns/deliverable/${application.deliverable.id}`} 
                className="w-full bg-green-500/20 hover:bg-green-500/30 text-green-400 font-bold py-2 rounded-lg text-xs transition-all flex items-center justify-center gap-2 border border-green-500/20"
              >
                View Metrics
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
