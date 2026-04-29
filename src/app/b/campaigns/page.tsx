export const dynamic = "force-dynamic";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus, Megaphone, ExternalLink, Calendar } from "lucide-react";

export default async function BrandCampaignsPage() {
  const session = await getSession();
  if (!session || session.role !== "BRAND_OWNER") redirect("/login");

  const brand = await prisma.brand.findUnique({
    where: { ownerUserId: session.userId },
  });

  if (!brand) redirect("/b/onboarding");

  const campaigns = await prisma.campaign.findMany({
    where: { brandId: brand.id },
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: { applications: true, deliverables: true },
      },
    },
  });

  return (
    <div className="space-y-8 pb-20">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-white mb-2">Campaigns</h1>
          <p className="text-gray-500">Manage your existing campaigns and review creator applications.</p>
        </div>
        <Link 
          href="/b/campaigns/new" 
          className="bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 px-6 rounded-xl text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-purple-500/20"
        >
          <Plus className="w-4 h-4" />
          Post Campaign
        </Link>
      </div>

      {campaigns.length === 0 ? (
        <div className="glass border border-white/5 rounded-3xl p-12 text-center max-w-2xl mx-auto">
          <div className="w-16 h-16 bg-purple-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Megaphone className="w-8 h-8 text-purple-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">No campaigns yet</h2>
          <p className="text-gray-500 mb-8 max-w-md mx-auto">
            You haven't posted any campaigns yet. Start by creating a brief to attract top TikTok creators to promote your brand.
          </p>
          <Link 
            href="/b/campaigns/new" 
            className="inline-flex bg-white hover:bg-gray-100 text-black font-bold py-3 px-8 rounded-xl text-sm transition-all items-center justify-center gap-2"
          >
            Create Your First Campaign
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {campaigns.map((campaign) => (
            <div key={campaign.id} className="glass border border-white/5 rounded-2xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 hover:border-purple-500/30 transition-all">
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-bold text-white">{campaign.title}</h3>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                    campaign.status === "OPEN" ? "bg-green-500/10 text-green-400" : 
                    campaign.status === "CLOSED" ? "bg-gray-500/10 text-gray-400" : "bg-yellow-500/10 text-yellow-400"
                  }`}>
                    {campaign.status}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    Deadline: {new Date(campaign.applicationDeadline).toLocaleDateString()}
                  </span>
                  <span>Payout: <strong className="text-green-400">${(campaign.payoutPerPostCents / 100).toFixed(2)}</strong></span>
                  <span>Spots: {campaign.maxCreators}</span>
                </div>
              </div>
              
              <div className="flex items-center gap-4 w-full md:w-auto">
                <div className="bg-white/5 rounded-xl px-4 py-2 text-center flex-1 md:flex-none">
                  <div className="text-xl font-black text-white">{campaign._count.applications}</div>
                  <div className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">Applied</div>
                </div>
                <div className="bg-white/5 rounded-xl px-4 py-2 text-center flex-1 md:flex-none">
                  <div className="text-xl font-black text-purple-400">{campaign._count.deliverables}</div>
                  <div className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">Active</div>
                </div>
                <Link 
                  href={`/b/campaigns/${campaign.id}`} 
                  className="bg-white/5 hover:bg-white/10 text-white p-3 rounded-xl transition-all"
                  title="Manage Campaign"
                >
                  <ExternalLink className="w-5 h-5" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
