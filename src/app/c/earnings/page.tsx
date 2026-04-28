export const dynamic = "force-dynamic";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { DollarSign } from "lucide-react";

export default async function EarningsPage() {
  const session = await getSession();
  if (!session) return null;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Earnings</h1>
      <div className="grid grid-cols-3 gap-4">
        {[["Total earned","$0"],["Pending payout","$0"],["Paid out","$0"]].map(([l,v])=>(<div key={l} className="glass border border-white/5 rounded-2xl p-5"><div className="text-2xl font-bold text-white">{v}</div><div className="text-xs text-gray-500 mt-1">{l}</div></div>))}
      </div>
      <div className="glass border border-white/5 rounded-2xl p-12 text-center">
        <DollarSign className="w-8 h-8 text-gray-600 mx-auto mb-3" />
        <p className="text-gray-500">No payout history yet. Complete your first campaign to start earning.</p>
      </div>
    </div>
  );
}
