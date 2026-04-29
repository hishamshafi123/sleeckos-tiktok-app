"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Check, X, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

export default function AdminBrandActions({ brandId }: { brandId: string }) {
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState("");
  const router = useRouter();

  const updateStatus = async (status: string) => {
    if (status === "REJECTED" && !reason) {
      toast.error("Please provide a reason for rejection.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/admin/brands/${brandId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, reason: status === "REJECTED" ? reason : undefined }),
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update status");
      
      toast.success(`Brand ${status.toLowerCase()}!`);
      router.refresh();
      router.push("/admin/brands");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
         <label className="text-xs text-gray-400 font-bold uppercase tracking-wider">Rejection Reason (Optional for approval)</label>
         <textarea
           value={reason}
           onChange={(e) => setReason(e.target.value)}
           placeholder="If rejecting, explain why..."
           className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 transition-all text-sm resize-none"
           rows={3}
         />
      </div>
      <div className="flex flex-col gap-3">
        <button
          onClick={() => updateStatus("APPROVED")}
          disabled={loading}
          className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white font-bold py-3 rounded-xl text-sm transition-all flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Approve Brand
        </button>
        <button
          onClick={() => updateStatus("REJECTED")}
          disabled={loading}
          className="w-full bg-red-600/10 hover:bg-red-600/20 disabled:opacity-40 text-red-400 font-bold py-3 rounded-xl text-sm transition-all flex items-center justify-center gap-2 border border-red-600/20"
        >
          <X className="w-4 h-4" />
          Reject Brand
        </button>
      </div>
    </div>
  );
}
