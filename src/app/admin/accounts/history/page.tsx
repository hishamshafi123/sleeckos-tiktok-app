export const dynamic = "force-dynamic";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { History as HistoryIcon, ExternalLink } from "lucide-react";

export default async function HistoryPage() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") redirect("/login");

  const posts = await prisma.scheduledPost.findMany({
    where: { status: { in: ["PUBLISHED", "SKIPPED"] } },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: 200,
    include: {
      account: {
        select: {
          tiktokUsername: true,
          tiktokAvatarUrl: true,
          group: { select: { name: true, section: { select: { name: true } } } },
        },
      },
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Post History</h1>
        <p className="text-gray-500 mt-1">All published and skipped posts</p>
      </div>

      <div className="glass border border-white/5 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5">
              <th className="text-left px-4 py-3 text-gray-500 font-medium">Account</th>
              <th className="text-left px-4 py-3 text-gray-500 font-medium">Section / Group</th>
              <th className="text-left px-4 py-3 text-gray-500 font-medium">Caption</th>
              <th className="text-left px-4 py-3 text-gray-500 font-medium">Status</th>
              <th className="text-right px-4 py-3 text-gray-500 font-medium">Views</th>
              <th className="text-right px-4 py-3 text-gray-500 font-medium">Likes</th>
              <th className="text-right px-4 py-3 text-gray-500 font-medium">Comments</th>
              <th className="text-left px-4 py-3 text-gray-500 font-medium">Published</th>
              <th className="text-left px-4 py-3 text-gray-500 font-medium">Link</th>
            </tr>
          </thead>
          <tbody>
            {posts.map((post) => (
              <tr key={post.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <img src={post.account.tiktokAvatarUrl || "/default-avatar.png"} className="w-6 h-6 rounded-full" alt="" />
                    <span className="text-white text-xs">@{post.account.tiktokUsername}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">{post.account.group.section.name} / {post.account.group.name}</td>
                <td className="px-4 py-3 text-gray-400 text-xs max-w-[220px]">
                  <p className="truncate" title={post.caption || ""}>{post.caption || "—"}</p>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    post.status === "PUBLISHED" ? "bg-green-500/10 text-green-400" : "bg-gray-500/10 text-gray-500"
                  }`}>{post.status}</span>
                </td>
                <td className="px-4 py-3 text-right text-gray-300 text-xs font-mono">{Number(post.viewCount).toLocaleString()}</td>
                <td className="px-4 py-3 text-right text-gray-300 text-xs font-mono">{Number(post.likeCount).toLocaleString()}</td>
                <td className="px-4 py-3 text-right text-gray-300 text-xs font-mono">{Number(post.commentCount).toLocaleString()}</td>
                <td className="px-4 py-3 text-gray-600 text-xs">{post.publishedAt ? new Date(post.publishedAt).toLocaleDateString() : "—"}</td>
                <td className="px-4 py-3">
                  {post.tiktokPostUrl ? (
                    <a href={post.tiktokPostUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 transition-colors">
                      <ExternalLink className="w-3 h-3" />
                      <span className="truncate max-w-[120px]">Open on TikTok</span>
                    </a>
                  ) : post.tiktokVideoId ? (
                    <a href={`https://www.tiktok.com/@${post.account.tiktokUsername}/video/${post.tiktokVideoId}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 transition-colors">
                      <ExternalLink className="w-3 h-3" />
                      <span>Open on TikTok</span>
                    </a>
                  ) : "—"}
                </td>
              </tr>
            ))}
            {posts.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-12 text-center text-gray-600">
                <HistoryIcon className="w-8 h-8 mx-auto mb-3 opacity-30" />
                No published posts yet. Posts will appear here after the scheduler runs.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
