export const dynamic = "force-dynamic";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import Link from "next/link";
import {
  CheckCircle2, ExternalLink, Users, Heart, Play, UserCheck,
  BadgeCheck, FileVideo, Link2
} from "lucide-react";

export default async function CreatorProfilePage() {
  const session = await getSession();
  if (!session) return null;

  const [profile, tiktok] = await Promise.all([
    prisma.creatorProfile.findUnique({ where: { userId: session.userId } }),
    prisma.tiktokAccount.findUnique({ where: { userId: session.userId } }),
  ]);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">My Profile</h1>
          <p className="text-gray-500 mt-1">Your TikTok identity as shown to brands</p>
        </div>
        <Link href="/c/connect-tiktok" className="text-sm text-purple-400 hover:text-purple-300 border border-purple-500/30 px-4 py-2 rounded-xl transition-colors">
          Reconnect TikTok
        </Link>
      </div>

      {/* No account connected */}
      {!tiktok && (
        <div className="glass border border-white/10 rounded-2xl p-12 text-center">
          <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <Users className="w-8 h-8 text-gray-600" />
          </div>
          <h3 className="text-white font-semibold mb-2">No TikTok account connected</h3>
          <p className="text-gray-500 text-sm mb-6">Connect your TikTok to display your profile here and apply to campaigns.</p>
          <Link href="/c/connect-tiktok" className="bg-purple-600 hover:bg-purple-500 text-white font-semibold px-6 py-3 rounded-xl text-sm transition-all inline-block">
            Connect TikTok →
          </Link>
        </div>
      )}

      {tiktok && (
        <>
          {/* Profile card */}
          <div className="glass border border-white/10 rounded-2xl p-8">
            <div className="flex items-start gap-6">
              {/* Avatar */}
              {tiktok.avatarUrl ? (
                <img
                  src={tiktok.avatarUrl}
                  alt={tiktok.displayName}
                  className="w-24 h-24 rounded-full object-cover border-2 border-purple-500/40 flex-shrink-0"
                />
              ) : (
                <div className="w-24 h-24 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0 border-2 border-purple-500/20">
                  <span className="text-purple-300 font-bold text-3xl">{tiktok.displayName?.[0] ?? "T"}</span>
                </div>
              )}

              {/* Identity */}
              <div className="flex-1">
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="text-2xl font-bold text-white">{tiktok.displayName}</h2>
                  {tiktok.isVerified && (
                    <span className="flex items-center gap-1 text-sm bg-blue-500/20 text-blue-300 border border-blue-500/30 px-3 py-1 rounded-full font-medium">
                      <BadgeCheck className="w-4 h-4" /> Verified
                    </span>
                  )}
                </div>
                <p className="text-purple-400 font-medium mt-1">@{tiktok.username}</p>

                {tiktok.bioDescription && (
                  <p className="text-gray-400 mt-3 leading-relaxed max-w-xl">{tiktok.bioDescription}</p>
                )}

                {/* Profile links */}
                <div className="flex items-center gap-4 mt-4 flex-wrap">
                  {tiktok.profileWebLink && (
                    <a
                      href={tiktok.profileWebLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-purple-300 transition-colors"
                    >
                      <ExternalLink className="w-4 h-4" />
                      TikTok Profile
                    </a>
                  )}
                  {tiktok.profileDeepLink && (
                    <a
                      href={tiktok.profileDeepLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-purple-300 transition-colors"
                    >
                      <Link2 className="w-4 h-4" />
                      Open in App
                    </a>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Stats grid — user.info.stats scope */}
          <div>
            <h2 className="text-lg font-semibold text-white mb-4">Audience Stats</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Followers", value: tiktok.followerCount.toLocaleString(), icon: Users, color: "text-purple-400", bg: "bg-purple-500/10" },
                { label: "Following", value: tiktok.followingCount.toLocaleString(), icon: UserCheck, color: "text-blue-400", bg: "bg-blue-500/10" },
                { label: "Total Likes", value: tiktok.likesCount.toLocaleString(), icon: Heart, color: "text-rose-400", bg: "bg-rose-500/10" },
                { label: "Total Videos", value: tiktok.videoCount.toLocaleString(), icon: Play, color: "text-amber-400", bg: "bg-amber-500/10" },
              ].map(({ label, value, icon: Icon, color, bg }) => (
                <div key={label} className="glass border border-white/5 rounded-2xl p-6 text-center">
                  <div className={`w-10 h-10 ${bg} rounded-xl flex items-center justify-center mx-auto mb-3`}>
                    <Icon className={`w-5 h-5 ${color}`} />
                  </div>
                  <div className="text-2xl font-bold text-white">{value}</div>
                  <div className="text-xs text-gray-500 mt-1">{label}</div>
                </div>
              ))}
            </div>
            {tiktok.statsUpdatedAt && (
              <p className="text-xs text-gray-600 mt-3 text-right">
                Stats last updated: {new Date(tiktok.statsUpdatedAt).toLocaleDateString()}
              </p>
            )}
          </div>

          {/* Creator marketplace profile */}
          {profile && (
            <div className="glass border border-white/10 rounded-2xl p-6 space-y-4">
              <h2 className="text-lg font-semibold text-white">Marketplace Profile</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Bio</p>
                  <p className="text-gray-300 text-sm leading-relaxed">{profile.bio || "No bio set."}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Niche Tags</p>
                  <div className="flex flex-wrap gap-2">
                    {profile.nicheTags.length > 0
                      ? profile.nicheTags.map((tag) => (
                          <span key={tag} className="text-xs bg-purple-500/10 text-purple-300 border border-purple-500/20 px-2.5 py-1 rounded-full">
                            #{tag}
                          </span>
                        ))
                      : <span className="text-gray-600 text-sm">No tags yet</span>}
                  </div>
                </div>
              </div>
              {profile.contentSampleUrls.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Content Samples</p>
                  <div className="flex flex-wrap gap-2">
                    {profile.contentSampleUrls.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 bg-purple-500/10 border border-purple-500/20 px-3 py-1.5 rounded-lg transition-colors">
                        <FileVideo className="w-3.5 h-3.5" /> Sample {i + 1}
                      </a>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2 pt-2 border-t border-white/5">
                <CheckCircle2 className={`w-4 h-4 ${profile.approvedAt ? "text-green-400" : "text-yellow-400"}`} />
                <span className="text-sm text-gray-400">
                  {profile.approvedAt ? "Approved creator — eligible for campaigns" : "Pending admin approval"}
                </span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
