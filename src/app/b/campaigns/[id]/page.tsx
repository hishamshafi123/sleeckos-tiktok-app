export const dynamic = "force-dynamic";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Users, Play, Heart, MessageCircle, Share2,
  Calendar, DollarSign, ExternalLink, CheckCircle
} from "lucide-react";
import BrandApplicationCard from "@/components/BrandApplicationCard";

export default async function BrandCampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "BRAND_OWNER") redirect("/login");

  const { id } = await params;

  const brand = await prisma.brand.findUnique({ where: { ownerUserId: session.userId } });
  if (!brand) redirect("/b/onboarding");

  const campaign = await prisma.campaign.findUnique({
    where: { id, brandId: brand.id },
    include: {
      applications: {
        include: {
          creatorUser: { include: { creatorProfile: true } },
          deliverable: {
            include: {
              metrics: { orderBy: { fetchedAt: "desc" }, take: 1 }
            }
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!campaign) notFound();

  // Aggregate campaign totals from all published deliverables
  const publishedDeliverables = campaign.applications
    .filter(a => a.deliverable?.status === "PUBLISHED")
    .map(a => a.deliverable!);

  const totalViews = publishedDeliverables.reduce((sum, d) => sum + Number(d.metrics[0]?.viewCount ?? 0), 0);
  const totalLikes = publishedDeliverables.reduce((sum, d) => sum + Number(d.metrics[0]?.likeCount ?? 0), 0);
  const totalComments = publishedDeliverables.reduce((sum, d) => sum + Number(d.metrics[0]?.commentCount ?? 0), 0);
  const totalShares = publishedDeliverables.reduce((sum, d) => sum + Number(d.metrics[0]?.shareCount ?? 0), 0);
  const publishedCount = publishedDeliverables.length;

  return (
    <div className="space-y-8 pb-20">
      <Link href="/b/campaigns" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-white transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Back to campaigns
      </Link>

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-white mb-2">{campaign.title}</h1>
          <div className="flex items-center gap-4 text-sm text-gray-400 flex-wrap">
            <span className={`px-2 py-1 rounded text-xs font-bold ${
              campaign.status === "OPEN" ? "bg-green-500/10 text-green-400" : "bg-yellow-500/10 text-yellow-400"
            }`}>{campaign.status}</span>
            <span className="flex items-center gap-1"><Calendar className="w-4 h-4" /> Deadline: {new Date(campaign.applicationDeadline).toLocaleDateString()}</span>
            <span className="flex items-center gap-1"><DollarSign className="w-4 h-4 text-green-400" /> ${(campaign.payoutPerPostCents / 100).toFixed(0)} per post</span>
            <span className="flex items-center gap-1"><Users className="w-4 h-4" /> {campaign.maxCreators} spots</span>
          </div>
        </div>
      </div>

      {/* Campaign Aggregate Metrics */}
      <div>
        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-widest mb-4">Campaign Performance</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Total Views", value: totalViews.toLocaleString(), icon: Play, color: "text-blue-400", bg: "bg-blue-400/5 border-blue-400/10" },
            { label: "Total Likes", value: totalLikes.toLocaleString(), icon: Heart, color: "text-pink-400", bg: "bg-pink-400/5 border-pink-400/10" },
            { label: "Comments", value: totalComments.toLocaleString(), icon: MessageCircle, color: "text-yellow-400", bg: "bg-yellow-400/5 border-yellow-400/10" },
            { label: "Shares", value: totalShares.toLocaleString(), icon: Share2, color: "text-green-400", bg: "bg-green-400/5 border-green-400/10" },
          ].map((stat) => (
            <div key={stat.label} className={`glass border rounded-2xl p-5 ${stat.bg}`}>
              <div className={`flex items-center gap-2 text-xs mb-2 ${stat.color}`}>
                <stat.icon className="w-3 h-3" />
                {stat.label}
              </div>
              <div className="text-2xl font-black text-white">{stat.value}</div>
              {publishedCount > 0 && (
                <div className="text-[10px] text-gray-600 mt-1">from {publishedCount} post{publishedCount !== 1 ? "s" : ""}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        {/* Creator Applications — per-creator dashboard */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-widest">Creator Applications ({campaign.applications.length})</h2>

          {campaign.applications.length === 0 ? (
            <div className="glass border border-white/5 rounded-2xl p-10 text-center text-gray-600 text-sm">
              No applications yet. Share your campaign link to attract creators!
            </div>
          ) : (
            <div className="space-y-4">
              {campaign.applications.map((app) => {
                const d = app.deliverable;
                const metric = d?.metrics?.[0];
                return (
                  <div key={app.id} className="glass border border-white/5 rounded-2xl overflow-hidden hover:border-white/10 transition-all">
                    {/* Creator Header */}
                    <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-purple-500/20 rounded-full flex items-center justify-center text-purple-300 text-xs font-bold">
                          {(app.creatorUser.creatorProfile?.displayName ?? app.creatorUser.email)[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-white">{app.creatorUser.creatorProfile?.displayName ?? app.creatorUser.email}</p>
                          <p className="text-[10px] text-gray-600">Applied {new Date(app.createdAt).toLocaleDateString()}</p>
                        </div>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-1 rounded ${
                        app.status === "ACCEPTED" ? "bg-green-500/10 text-green-400" :
                        app.status === "REJECTED" ? "bg-red-500/10 text-red-400" : "bg-gray-500/10 text-gray-400"
                      }`}>{app.status}</span>
                    </div>

                    {/* Per-creator mini metrics (only if published) */}
                    {d?.status === "PUBLISHED" && metric && (
                      <div className="grid grid-cols-4 divide-x divide-white/5 border-b border-white/5">
                        {[
                          { label: "Views", value: Number(metric.viewCount).toLocaleString(), icon: Play },
                          { label: "Likes", value: Number(metric.likeCount).toLocaleString(), icon: Heart },
                          { label: "Comments", value: Number(metric.commentCount).toLocaleString(), icon: MessageCircle },
                          { label: "Shares", value: Number(metric.shareCount).toLocaleString(), icon: Share2 },
                        ].map((stat) => (
                          <div key={stat.label} className="px-4 py-3 text-center">
                            <div className="flex items-center justify-center gap-1 text-gray-600 text-[10px] mb-1">
                              <stat.icon className="w-2.5 h-2.5" />{stat.label}
                            </div>
                            <div className="text-sm font-bold text-white">{stat.value}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Deliverable status bar */}
                    {d && d.status !== "PUBLISHED" && (
                      <div className="px-6 py-3 border-b border-white/5 flex items-center justify-between">
                        <span className="text-xs text-gray-500">{d.status.replace(/_/g, " ")}</span>
                        {d.draftVideoUrl && (
                          <a href={d.draftVideoUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-purple-400 text-xs hover:underline">
                            View Draft <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    )}

                    {/* Action area */}
                    <div className="px-6 py-4">
                      <BrandApplicationCard application={app} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Campaign Brief sidebar */}
        <div className="space-y-6">
          <div className="glass border border-white/5 rounded-3xl p-6 space-y-4">
            <h3 className="text-white font-bold text-sm">Campaign Brief</h3>
            <p className="text-gray-400 text-xs leading-relaxed">{campaign.description}</p>
            <div className="pt-3 border-t border-white/5 text-xs text-gray-400 leading-relaxed italic">"{campaign.brief.slice(0, 200)}..."</div>
          </div>

          {(campaign.requiredHashtags.length > 0 || campaign.requiredMentions.length > 0) && (
            <div className="glass border border-white/5 rounded-3xl p-6 space-y-4">
              {campaign.requiredHashtags.length > 0 && (
                <div>
                  <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mb-2">Required Hashtags</p>
                  <div className="flex flex-wrap gap-1">
                    {campaign.requiredHashtags.map(tag => (
                      <span key={tag} className="text-xs text-purple-300 bg-purple-500/10 px-2 py-0.5 rounded">#{tag}</span>
                    ))}
                  </div>
                </div>
              )}
              {campaign.requiredMentions.length > 0 && (
                <div>
                  <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mb-2">Required Mentions</p>
                  <div className="flex flex-wrap gap-1">
                    {campaign.requiredMentions.map(m => (
                      <span key={m} className="text-xs text-blue-300 bg-blue-500/10 px-2 py-0.5 rounded">@{m}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
