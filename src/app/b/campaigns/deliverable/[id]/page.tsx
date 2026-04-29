export const dynamic = "force-dynamic";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Play, BarChart3, MessageSquare, ExternalLink, Video } from "lucide-react";

export default async function BrandDeliverableMetricsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "BRAND_OWNER") redirect("/login");

  const { id } = await params;

  const brand = await prisma.brand.findUnique({
    where: { ownerUserId: session.userId },
  });

  if (!brand) redirect("/b/onboarding");

  const deliverable = await prisma.deliverable.findUnique({
    where: { id },
    include: {
      campaign: true,
      creatorUser: { include: { creatorProfile: true } },
      metrics: { orderBy: { fetchedAt: "desc" }, take: 1 }
    }
  });

  if (!deliverable || deliverable.campaign.brandId !== brand.id) notFound();

  const latestMetric = deliverable.metrics[0];

  return (
    <div className="space-y-8 pb-20">
      <Link href={`/b/campaigns/${deliverable.campaignId}`} className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-white transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Back to campaign
      </Link>

      <div className="flex flex-col md:flex-row gap-8">
        <div className="flex-1 space-y-6">
          <div>
            <h1 className="text-3xl font-black text-white mb-2">Metrics Tracking</h1>
            <p className="text-gray-500">Live performance data for {deliverable.creatorUser.creatorProfile?.displayName || 'Creator'}&apos;s post on campaign: {deliverable.campaign.title}.</p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Views", value: latestMetric?.viewCount?.toString() || "0", icon: Play },
              { label: "Likes", value: latestMetric?.likeCount?.toString() || "0", icon: BarChart3 },
              { label: "Comments", value: latestMetric?.commentCount?.toString() || "0", icon: MessageSquare },
              { label: "Shares", value: latestMetric?.shareCount?.toString() || "0", icon: ExternalLink },
            ].map((stat, i) => (
              <div key={i} className="glass border border-white/5 rounded-2xl p-5">
                <div className="flex items-center gap-2 text-gray-500 text-xs mb-2">
                  <stat.icon className="w-3 h-3" />
                  {stat.label}
                </div>
                <div className="text-xl font-bold text-white">{stat.value}</div>
              </div>
            ))}
          </div>

          <div className="glass border border-white/5 rounded-3xl p-8 space-y-6">
            <h3 className="text-white font-bold flex items-center gap-2 mb-4">
              <Video className="w-4 h-4 text-purple-400" />
              Content Delivery Details
            </h3>
            
            <div className="space-y-4">
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mb-1">Status</p>
                <span className="bg-green-500/10 text-green-400 text-sm font-bold px-4 py-2 rounded-xl inline-block">{deliverable.status.replace(/_/g, ' ')}</span>
              </div>
              
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mb-1">Draft Video</p>
                {deliverable.draftVideoUrl ? (
                  <a href={deliverable.draftVideoUrl} target="_blank" rel="noopener noreferrer" className="text-purple-400 text-sm bg-purple-500/10 px-4 py-2 rounded-xl inline-flex items-center gap-2 hover:underline">
                    Watch Draft <ExternalLink className="w-3 h-3" />
                  </a>
                ) : (
                  <span className="text-gray-500 text-sm">Not provided</span>
                )}
              </div>

              <div>
                <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mb-1">Live TikTok Link</p>
                {deliverable.tiktokPostUrl ? (
                  <a href={deliverable.tiktokPostUrl} target="_blank" rel="noopener noreferrer" className="text-green-400 text-sm bg-green-500/10 px-4 py-2 rounded-xl inline-flex items-center gap-2 hover:underline">
                    View on TikTok <ExternalLink className="w-3 h-3" />
                  </a>
                ) : (
                  <span className="text-gray-500 text-sm">Not published yet or link unavailable</span>
                )}
              </div>

              <div>
                <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mb-1">Caption Used</p>
                <div className="bg-white/5 p-4 rounded-xl text-sm text-gray-300">
                  {deliverable.draftCaption || "No caption provided"}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
