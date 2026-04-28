import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Video, MessageSquare, BarChart3, Lock, ExternalLink, Play } from "lucide-react";
import DeliverableSubmissionForm from "@/components/DeliverableSubmissionForm";

export default async function ActiveWorkDetailPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;

  const deliverable = await prisma.deliverable.findUnique({
    where: { id },
    include: { 
      campaign: { include: { brand: true } },
      metrics: { orderBy: { fetchedAt: "desc" }, take: 1 }
    }
  });

  if (!deliverable) notFound();

  const latestMetric = deliverable.metrics[0];

  return (
    <div className="space-y-8 pb-20">
      <Link href="/c/active" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-white transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Back to active work
      </Link>

      <div className="flex flex-col lg:flex-row gap-8">
        <div className="flex-1 space-y-8">
          <div>
            <h1 className="text-3xl font-black text-white mb-2">{deliverable.campaign.title}</h1>
            <p className="text-gray-500">Deliverable for {deliverable.campaign.brand.tradeName}</p>
          </div>

          {/* Metrics Section (if published) */}
          {deliverable.status === "PUBLISHED" && (
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
          )}

          <div className="glass border border-white/5 rounded-3xl overflow-hidden">
            <div className="border-b border-white/5 bg-white/2 px-8 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <Video className="w-4 h-4 text-purple-400" />
                Submission & Status
              </div>
              <span className="text-[10px] uppercase tracking-widest text-gray-500 font-bold bg-white/5 px-2 py-1 rounded">
                ID: {deliverable.id.slice(0, 8)}
              </span>
            </div>
            
            <div className="p-8">
              {deliverable.status === "BRIEFED" || deliverable.status === "DRAFT_NEEDS_CHANGES" ? (
                <DeliverableSubmissionForm deliverable={deliverable} />
              ) : deliverable.status === "DRAFT_UPLOADED" ? (
                <div className="text-center py-10 space-y-4">
                  <div className="w-16 h-16 bg-yellow-500/10 rounded-full flex items-center justify-center mx-auto">
                    <Clock className="w-8 h-8 text-yellow-500" />
                  </div>
                  <h3 className="text-white font-bold text-lg">Under Review</h3>
                  <p className="text-gray-500 text-sm max-w-sm mx-auto">
                    Your draft has been submitted. The brand will review it shortly. You&apos;ll be notified if they request changes or approve it.
                  </p>
                </div>
              ) : deliverable.status === "DRAFT_APPROVED" || deliverable.status === "READY_TO_PUBLISH" ? (
                <div className="text-center py-10 space-y-6">
                  <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto">
                    <CheckCircle className="w-8 h-8 text-green-500" />
                  </div>
                  <div>
                    <h3 className="text-white font-bold text-lg">Draft Approved!</h3>
                    <p className="text-gray-500 text-sm max-w-sm mx-auto mt-2">
                      Your content is ready for the final step. Publish it directly to your TikTok account via our compliant composer.
                    </p>
                  </div>
                  <Link 
                    href={`/publishing/${deliverable.id}`} 
                    className="inline-flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white font-black px-10 py-4 rounded-2xl transition-all shadow-xl shadow-purple-500/20 active:scale-95"
                  >
                    Open Compliant Composer <ArrowRight className="w-5 h-5" />
                  </Link>
                </div>
              ) : (
                <div className="text-center py-10 space-y-4">
                  <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto">
                    <CheckCircle className="w-8 h-8 text-green-500" />
                  </div>
                  <h3 className="text-white font-bold text-lg">Published & Verified</h3>
                  <p className="text-gray-500 text-sm max-w-sm mx-auto">
                    This deliverable is complete. Your post is live on TikTok and metrics are being tracked.
                  </p>
                  {deliverable.tiktokPostUrl && (
                    <a href={deliverable.tiktokPostUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-purple-400 hover:text-white transition-colors text-sm">
                      View on TikTok <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar Info */}
        <div className="w-full lg:w-96 space-y-6">
          <div className="glass border border-white/5 rounded-3xl p-8 space-y-6">
            <h4 className="text-white font-bold flex items-center gap-2">
              <Lock className="w-4 h-4 text-purple-400" />
              Campaign Guidelines
            </h4>
            <div className="space-y-4">
              <div className="bg-white/2 rounded-xl p-4">
                <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">Required Hashtags</p>
                <div className="flex flex-wrap gap-2">
                  {deliverable.campaign.requiredHashtags.map(tag => (
                    <span key={tag} className="text-xs text-purple-300 bg-purple-500/10 px-2 py-1 rounded">#{tag}</span>
                  ))}
                </div>
              </div>
              <div className="bg-white/2 rounded-xl p-4">
                <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">Required Mentions</p>
                <div className="flex flex-wrap gap-2">
                  {deliverable.campaign.requiredMentions.map(m => (
                    <span key={m} className="text-xs text-blue-300 bg-blue-500/10 px-2 py-1 rounded">@{m}</span>
                  ))}
                </div>
              </div>
            </div>
            
            <div className="pt-4 border-t border-white/5">
              <p className="text-xs text-gray-500 leading-relaxed italic">
                &quot;{deliverable.campaign.brief.slice(0, 150)}...&quot;
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Clock({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function CheckCircle({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function ArrowRight({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
    </svg>
  );
}
