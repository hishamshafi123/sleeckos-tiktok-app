export const dynamic = "force-dynamic";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import Link from "next/link";
import { Search } from "lucide-react";

const CAT_COLORS: Record<string,string> = {
  BEAUTY:"text-pink-400 bg-pink-400/10", FITNESS:"text-green-400 bg-green-400/10",
  FASHION:"text-yellow-400 bg-yellow-400/10", FOOD:"text-orange-400 bg-orange-400/10",
  TECH:"text-blue-400 bg-blue-400/10", TRAVEL:"text-cyan-400 bg-cyan-400/10",
};

export default async function CreatorCampaignsPage() {
  const session = await getSession();
  if (!session) return null;

  const campaigns = await prisma.campaign.findMany({
    where: { status: "OPEN" },
    include: { brand: true, _count: { select: { applications: true } } },
    orderBy: { createdAt: "desc" },
  });

  const DEMO_EXTRA = [
    { id:"d1", brand:{ tradeName:"Lumina Beauty", brandLogoUrl:null }, category:"BEAUTY", title:"Skincare Glow-Up Routine", payoutPerPostCents:35000, maxCreators:3, nicheTags:["beauty","skincare"], _count:{ applications: 7 } },
    { id:"d2", brand:{ tradeName:"TrailForge", brandLogoUrl:null }, category:"FITNESS", title:"Outdoor Adventure Gear Review", payoutPerPostCents:50000, maxCreators:5, nicheTags:["fitness"], _count:{ applications: 12 } },
    { id:"d3", brand:{ tradeName:"UrbanThreads", brandLogoUrl:null }, category:"FASHION", title:"OOTD Street Style", payoutPerPostCents:28000, maxCreators:8, nicheTags:["fashion"], _count:{ applications: 4 } },
  ];

  const allCampaigns = [...campaigns, ...(campaigns.length < 3 ? DEMO_EXTRA : [])];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Browse Campaigns</h1>
        <p className="text-gray-500 mt-1 text-sm">All posts include mandatory Branded Content disclosure</p>
      </div>

      {allCampaigns.length === 0 ? (
        <div className="glass border border-white/5 rounded-2xl p-12 text-center">
          <Search className="w-8 h-8 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500">No open campaigns right now. Check back soon!</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-5">
          {allCampaigns.map((c) => (
            <div key={c.id} className="glass border border-white/5 rounded-2xl p-5 hover:border-purple-500/30 transition-all">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-xs text-gray-500">{c.brand.tradeName}</p>
                  <h3 className="font-semibold text-white mt-0.5">{c.title}</h3>
                </div>
                <span className={`text-xs font-semibold px-2 py-1 rounded-full ${CAT_COLORS[(c as any).category || "LIFESTYLE"] || "text-purple-400 bg-purple-400/10"}`}>
                  {(c as any).category || "LIFESTYLE"}
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap mb-4">
                {(c.nicheTags || []).slice(0,3).map((t) => <span key={t} className="text-xs text-gray-500 bg-white/5 px-2 py-0.5 rounded-full">#{t}</span>)}
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-white/5">
                <span className="text-green-400 font-bold">${(c.payoutPerPostCents/100).toFixed(0)}</span>
                <span className="text-xs text-gray-500">{c.maxCreators} spots · {c._count.applications} applied</span>
              </div>
              <Link href={`/c/campaigns/${c.id}`} className="mt-3 w-full bg-purple-600 hover:bg-purple-500 text-white font-semibold py-2 rounded-xl text-sm transition-all flex items-center justify-center">
                View & Apply
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
