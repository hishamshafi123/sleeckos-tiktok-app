export const dynamic = "force-dynamic";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { Clock, RefreshCw } from "lucide-react";
import Link from "next/link";

export default async function QueuePage() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") redirect("/login");

  const posts = await prisma.scheduledPost.findMany({
    where: { status: { in: ["QUEUED", "DOWNLOADING", "UPLOADING", "PROCESSING", "FAILED"] } },
    orderBy: { scheduledFor: "asc" },
    take: 50,
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

  const statusColor: Record<string, string> = {
    QUEUED: "bg-gray-500/10 text-gray-400",
    DOWNLOADING: "bg-blue-500/10 text-blue-400",
    UPLOADING: "bg-blue-500/10 text-blue-400",
    PROCESSING: "bg-amber-500/10 text-amber-400",
    FAILED: "bg-red-500/10 text-red-400",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Post Queue</h1>
        <p className="text-gray-500 mt-1">Upcoming and in-progress scheduled posts</p>
      </div>

      <div className="glass border border-white/5 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5">
              <th className="text-left px-4 py-3 text-gray-500 font-medium">Account</th>
              <th className="text-left px-4 py-3 text-gray-500 font-medium">Section / Group</th>
              <th className="text-left px-4 py-3 text-gray-500 font-medium">Video</th>
              <th className="text-left px-4 py-3 text-gray-500 font-medium">Scheduled For</th>
              <th className="text-left px-4 py-3 text-gray-500 font-medium">Status</th>
              <th className="text-left px-4 py-3 text-gray-500 font-medium">Error</th>
            </tr>
          </thead>
          <tbody>
            {posts.map((post) => (
              <tr key={post.id} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <img src={post.account.tiktokAvatarUrl || "/default-avatar.png"} className="w-6 h-6 rounded-full" alt="" />
                    <span className="text-white text-xs">@{post.account.tiktokUsername}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">{post.account.group.section.name} / {post.account.group.name}</td>
                <td className="px-4 py-3 text-gray-400 text-xs max-w-[150px] truncate">{post.driveFileName || "—"}</td>
                <td className="px-4 py-3 text-gray-400 text-xs">{new Date(post.scheduledFor).toLocaleString()}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${statusColor[post.status] || "bg-gray-500/10 text-gray-400"}`}>
                    {post.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-red-400 text-xs max-w-[200px] truncate">{post.errorMessage || "—"}</td>
              </tr>
            ))}
            {posts.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-600">
                <Clock className="w-8 h-8 mx-auto mb-3 opacity-30" />
                No posts in queue. Posts will appear here when the scheduler runs.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
