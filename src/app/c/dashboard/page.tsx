export const dynamic = "force-dynamic";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import Link from "next/link";
import { TrendingUp, CheckCircle2, Clock, Heart, Play, Users } from "lucide-react";

export default async function CreatorDashboard() {
  const session = await getSession();
  if (!session) return null;

  const [profile, tiktok, applications] = await Promise.all([
    prisma.creatorProfile.findUnique({ where: { userId: session.userId } }),
    prisma.tiktokAccount.findUnique({ where: { userId: session.userId } }),
    prisma.application.findMany({
      where: { creatorUserId: session.userId },
      include: { campaign: { include: { brand: true } } },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  const STATUS_COLORS: Record<string, string> = {
    SUBMITTED: "text-yellow-400 bg-yellow-400/10",
    UNDER_REVIEW: "text-blue-400 bg-blue-400/10",
    ACCEPTED: "text-green-400 bg-green-400/10",
    REJECTED: "text-red-400 bg-red-400/10",
    WITHDRAWN: "text-gray-400 bg-gray-400/10",
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Welcome back, {profile?.displayName || session.email} 👋</h1>
        <p className="text-gray-500 mt-1">Here&apos;s your creator dashboard</p>
      </div>

      {/* TikTok connect banner */}
      {!tiktok && (
        <div className="bg-purple-500/10 border border-purple-500/20 rounded-2xl p-6 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-white mb-1">Connect your TikTok account</h3>
            <p className="text-gray-500 text-sm">You need to connect TikTok before applying to campaigns</p>
          </div>
          <Link href="/c/connect-tiktok" className="bg-purple-600 hover:bg-purple-500 text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-all flex-shrink-0">
            Connect TikTok →
          </Link>
        </div>
      )}

      {/* TikTok connected card — surfaces all user.info.profile + user.info.stats data */}
      {tiktok && (
        <div className="glass border border-white/10 rounded-2xl p-5 flex items-center gap-5">
          {tiktok.avatarUrl ? (
            <img src={tiktok.avatarUrl} alt={tiktok.displayName} className="w-14 h-14 rounded-full object-cover border-2 border-purple-500/40 flex-shrink-0" />
          ) : (
            <div className="w-14 h-14 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0">
              <span className="text-purple-300 font-bold text-lg">{tiktok.displayName?.[0] ?? "T"}</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-white font-semibold">@{tiktok.username}</p>
              {tiktok.isVerified && (
                <span className="text-xs bg-blue-500/20 text-blue-300 border border-blue-500/30 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Verified
                </span>
              )}
              <span className="text-xs bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-0.5 rounded-full font-medium">Connected</span>
            </div>
            {tiktok.bioDescription && (
              <p className="text-xs text-gray-500 mt-1 truncate max-w-sm">{tiktok.bioDescription}</p>
            )}
            <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
              <span><span className="text-white font-semibold">{tiktok.followerCount.toLocaleString()}</span> Followers</span>
              <span><span className="text-white font-semibold">{tiktok.followingCount.toLocaleString()}</span> Following</span>
              <span><span className="text-white font-semibold">{tiktok.likesCount.toLocaleString()}</span> Likes</span>
              <span><span className="text-white font-semibold">{tiktok.videoCount.toLocaleString()}</span> Videos</span>
            </div>
          </div>
          <Link href="/c/profile" className="text-xs text-purple-400 hover:text-purple-300 font-medium flex-shrink-0 transition-colors">
            View profile →
          </Link>
        </div>
      )}

      {/* Stat cards — live from TikTok scopes */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Followers", value: tiktok ? tiktok.followerCount.toLocaleString() : "—", icon: Users, color: "text-purple-400" },
          { label: "Total Videos", value: tiktok ? String(tiktok.videoCount) : "—", icon: Play, color: "text-blue-400" },
          { label: "Applications", value: String(applications.length), icon: TrendingUp, color: "text-green-400" },
          { label: "Total Likes", value: tiktok ? tiktok.likesCount.toLocaleString() : "—", icon: Heart, color: "text-amber-400" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="glass border border-white/5 rounded-2xl p-5">
            <Icon className={`w-5 h-5 ${color} mb-3`} />
            <div className="text-2xl font-bold text-white">{value}</div>
            <div className="text-xs text-gray-500 mt-1">{label}</div>
          </div>
        ))}
      </div>

      {/* Recent applications */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-white">Recent Applications</h2>
          <Link href="/c/applications" className="text-sm text-purple-400 hover:text-purple-300 transition-colors">View all →</Link>
        </div>
        {applications.length === 0 ? (
          <div className="glass border border-white/5 rounded-2xl p-10 text-center">
            <Clock className="w-8 h-8 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500 mb-4">No applications yet</p>
            <Link href="/c/campaigns" className="bg-purple-600 hover:bg-purple-500 text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-all inline-block">
              Browse campaigns →
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {applications.map((app) => (
              <div key={app.id} className="glass border border-white/5 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-white text-sm">{app.campaign.title}</p>
                  <p className="text-xs text-gray-500">{app.campaign.brand.tradeName}</p>
                </div>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_COLORS[app.status]}`}>{app.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
