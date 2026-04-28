export const dynamic = "force-dynamic";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import Link from "next/link";
import { Zap } from "lucide-react";

export default async function ActiveCampaignsPage() {
  const session = await getSession();
  if (!session) return null;
  const deliverables = await prisma.deliverable.findMany({
    where: { creatorUserId: session.userId },
    include: { campaign: { include: { brand: true } } },
    orderBy: { createdAt: "desc" },
  });
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Active Work</h1>
      {deliverables.length === 0 ? (
        <div className="glass border border-white/5 rounded-2xl p-12 text-center">
          <Zap className="w-8 h-8 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500">No active campaigns. Get accepted to a campaign to see it here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {deliverables.map((d)=>(
            <Link key={d.id} href={`/c/active/${d.id}`} className="glass border border-white/5 rounded-xl p-5 flex items-center justify-between hover:border-purple-500/30 transition-all block">
              <div>
                <p className="font-medium text-white">{d.campaign.title}</p>
                <p className="text-xs text-gray-500">{d.campaign.brand.tradeName}</p>
              </div>
              <span className="text-xs text-purple-300 bg-purple-500/10 px-2.5 py-1 rounded-full font-semibold">{d.status}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
