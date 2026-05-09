export const dynamic = "force-dynamic";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { BarChart3, TrendingUp, Eye, Heart, Video, AlertCircle } from "lucide-react";

export default async function AccountsDashboard() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") redirect("/login");

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(todayStart.getTime() - 7 * 86400000);
  const monthAgo = new Date(todayStart.getTime() - 30 * 86400000);

  const [totalAccounts, totalSections, totalGroups, postsToday, postsWeek, postsMonth, failedPosts, recentPosts] = await Promise.all([
    prisma.managedAccount.count(),
    prisma.accountSection.count(),
    prisma.accountGroup.count(),
    prisma.scheduledPost.count({ where: { status: "PUBLISHED", publishedAt: { gte: todayStart } } }),
    prisma.scheduledPost.count({ where: { status: "PUBLISHED", publishedAt: { gte: weekAgo } } }),
    prisma.scheduledPost.count({ where: { status: "PUBLISHED", publishedAt: { gte: monthAgo } } }),
    prisma.scheduledPost.count({ where: { status: "FAILED" } }),
    prisma.scheduledPost.findMany({
      orderBy: { createdAt: "desc" },
      take: 15,
      include: {
        account: {
          select: { tiktokUsername: true, tiktokAvatarUrl: true, group: { select: { name: true, section: { select: { name: true } } } } },
        },
      },
    }),
  ]);

  const stats = [
    { label: "Total Accounts", value: totalAccounts, icon: Video, color: "text-purple-400", bg: "bg-purple-400/10 border-purple-500/20" },
    { label: "Posts Today", value: postsToday, icon: TrendingUp, color: "text-green-400", bg: "bg-green-400/10 border-green-500/20" },
    { label: "Posts This Week", value: postsWeek, icon: BarChart3, color: "text-blue-400", bg: "bg-blue-400/10 border-blue-500/20" },
    { label: "Posts This Month", value: postsMonth, icon: Eye, color: "text-amber-400", bg: "bg-amber-400/10 border-amber-500/20" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Analytics Dashboard</h1>
        <p className="text-gray-500 mt-1">Overview of all managed TikTok accounts and posting activity</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        {stats.map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className={`glass border rounded-2xl p-6 ${bg}`}>
            <Icon className={`w-5 h-5 ${color} mb-2`} />
            <div className={`text-3xl font-black mb-1 ${color}`}>{value}</div>
            <div className="text-sm text-gray-400">{label}</div>
          </div>
        ))}
      </div>

      {/* Alerts */}
      {failedPosts > 0 && (
        <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-2xl px-5 py-4">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
          <div>
            <p className="text-sm text-red-300 font-medium">{failedPosts} failed post{failedPosts !== 1 ? "s" : ""} need attention</p>
            <p className="text-xs text-red-400/60">Check the Post Queue to retry or investigate</p>
          </div>
        </div>
      )}

      {/* Platform stats */}
      <div className="grid grid-cols-3 gap-4 text-center">
        <div className="glass border border-white/5 rounded-2xl p-5">
          <div className="text-2xl font-black text-white">{totalSections}</div>
          <div className="text-sm text-gray-500">Sections</div>
        </div>
        <div className="glass border border-white/5 rounded-2xl p-5">
          <div className="text-2xl font-black text-white">{totalGroups}</div>
          <div className="text-sm text-gray-500">Groups</div>
        </div>
        <div className="glass border border-white/5 rounded-2xl p-5">
          <div className="text-2xl font-black text-white">{totalAccounts}</div>
          <div className="text-sm text-gray-500">Accounts</div>
        </div>
      </div>

      {/* Recent posts */}
      <div>
        <h2 className="font-semibold text-white mb-4">Recent Posts</h2>
        <div className="glass border border-white/5 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Account</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Section / Group</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Caption</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Status</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Views</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {recentPosts.map((post) => (
                <tr key={post.id} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <img src={post.account.tiktokAvatarUrl || "/default-avatar.png"} className="w-6 h-6 rounded-full" alt="" />
                      <span className="text-white text-xs">@{post.account.tiktokUsername}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{post.account.group.section.name} / {post.account.group.name}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs max-w-[200px] truncate">{post.caption || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      post.status === "PUBLISHED" ? "bg-green-500/10 text-green-400" :
                      post.status === "FAILED" ? "bg-red-500/10 text-red-400" :
                      post.status === "PROCESSING" ? "bg-blue-500/10 text-blue-400" :
                      "bg-gray-500/10 text-gray-400"
                    }`}>{post.status}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{Number(post.viewCount).toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{post.createdAt ? new Date(post.createdAt).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
              {recentPosts.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-600">No posts yet. Connect accounts and set up scheduling to get started.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
