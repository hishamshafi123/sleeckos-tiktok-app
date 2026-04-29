export const dynamic = "force-dynamic";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Play, Heart, MessageCircle, Share2, CheckCircle, Clock, Upload, ExternalLink } from "lucide-react";
import CreatorDeliverableClient from "@/components/creator/DeliverableClient";

export default async function CreatorActiveDeliverablePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;

  const deliverable = await prisma.deliverable.findUnique({
    where: { id },
    include: {
      campaign: { include: { brand: true } },
      creatorUser: { include: { tiktokAccount: true } },
      metrics: { orderBy: { fetchedAt: "desc" }, take: 10 }
    }
  });

  if (!deliverable || deliverable.creatorUserId !== session.userId) notFound();

  const latestMetric = deliverable.metrics[0] ?? null;

  return (
    <div className="space-y-8 pb-20">
      <Link href="/c/active" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-white transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Back to active work
      </Link>

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <p className="text-xs text-gray-600 uppercase tracking-widest font-bold mb-1">{deliverable.campaign.brand.tradeName}</p>
          <h1 className="text-3xl font-black text-white">{deliverable.campaign.title}</h1>
        </div>
        <StatusBadge status={deliverable.status} />
      </div>

      {/* Metrics Bar — only show if published */}
      {deliverable.status === "PUBLISHED" && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Views", value: latestMetric ? Number(latestMetric.viewCount).toLocaleString() : "—", icon: Play, color: "text-blue-400" },
            { label: "Likes", value: latestMetric ? Number(latestMetric.likeCount).toLocaleString() : "—", icon: Heart, color: "text-pink-400" },
            { label: "Comments", value: latestMetric ? Number(latestMetric.commentCount).toLocaleString() : "—", icon: MessageCircle, color: "text-yellow-400" },
            { label: "Shares", value: latestMetric ? Number(latestMetric.shareCount).toLocaleString() : "—", icon: Share2, color: "text-green-400" },
          ].map((stat) => (
            <div key={stat.label} className="glass border border-white/5 rounded-2xl p-5">
              <div className={`flex items-center gap-2 text-xs mb-2 ${stat.color}`}>
                <stat.icon className="w-3 h-3" />
                {stat.label}
              </div>
              <div className="text-2xl font-black text-white">{stat.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-8">
        {/* Main: Deliverable Action Area */}
        <div className="lg:col-span-2">
          <CreatorDeliverableClient deliverable={deliverable} tiktokAccount={deliverable.creatorUser.tiktokAccount} />
        </div>

        {/* Sidebar: Campaign Brief */}
        <div className="space-y-6">
          <div className="glass border border-white/5 rounded-3xl p-6 space-y-4">
            <h3 className="text-white font-bold text-sm">Campaign Brief</h3>
            <p className="text-gray-400 text-xs leading-relaxed">{deliverable.campaign.brief}</p>

            {deliverable.campaign.requiredHashtags.length > 0 && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mb-2">Required Hashtags</p>
                <div className="flex flex-wrap gap-1">
                  {deliverable.campaign.requiredHashtags.map(tag => (
                    <span key={tag} className="text-xs text-purple-300 bg-purple-500/10 px-2 py-0.5 rounded">#{tag}</span>
                  ))}
                </div>
              </div>
            )}

            {deliverable.campaign.requiredMentions.length > 0 && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mb-2">Required Mentions</p>
                <div className="flex flex-wrap gap-1">
                  {deliverable.campaign.requiredMentions.map(m => (
                    <span key={m} className="text-xs text-blue-300 bg-blue-500/10 px-2 py-0.5 rounded">@{m}</span>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-3 border-t border-white/5">
              <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mb-1">Payout</p>
              <p className="text-green-400 font-black text-xl">${(deliverable.campaign.payoutPerPostCents / 100).toFixed(2)}</p>
            </div>
          </div>

          {deliverable.brandFeedback && (
            <div className="glass border border-amber-500/20 bg-amber-500/5 rounded-3xl p-6">
              <h3 className="text-amber-400 font-bold text-sm mb-2">Brand Feedback</h3>
              <p className="text-gray-300 text-xs leading-relaxed">{deliverable.brandFeedback}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; classes: string }> = {
    BRIEFED: { label: "Awaiting Your Upload", classes: "bg-gray-500/10 text-gray-400 border-gray-500/20" },
    DRAFT_UPLOADED: { label: "Under Brand Review", classes: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" },
    DRAFT_NEEDS_CHANGES: { label: "Changes Requested", classes: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
    DRAFT_APPROVED: { label: "Approved — Ready to Publish", classes: "bg-green-500/10 text-green-400 border-green-500/20" },
    PUBLISHED: { label: "Published ✓", classes: "bg-purple-500/10 text-purple-300 border-purple-500/20" },
  };
  const s = map[status] ?? { label: status, classes: "bg-white/5 text-gray-400 border-white/10" };
  return (
    <span className={`inline-flex items-center px-4 py-2 rounded-xl text-sm font-bold border ${s.classes}`}>
      {s.label}
    </span>
  );
}
