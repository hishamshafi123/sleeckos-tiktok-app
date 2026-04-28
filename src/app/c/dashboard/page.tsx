export const dynamic = "force-dynamic";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import Link from "next/link";
import { TrendingUp, DollarSign, CheckCircle2, Clock, Zap } from "lucide-react";

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

      {tiktok && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-2xl p-4 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0" />
          <div>
            <p className="text-sm text-white font-medium">TikTok connected: <span className="text-green-400">@{tiktok.username}</span></p>
            <p className="text-xs text-gray-500">You can apply to campaigns</p>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total earned", value: "$0", icon: DollarSign, color: "text-green-400" },
          { label: "Active campaigns", value: "0", icon: Zap, color: "text-purple-400" },
          { label: "Applications", value: String(applications.length), icon: TrendingUp, color: "text-blue-400" },
          { label: "Published posts", value: "0", icon: CheckCircle2, color: "text-amber-400" },
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
          <Link href="/c/applications" className="text-sm text-purple-400 hover:text-purple-300">View all →</Link>
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
