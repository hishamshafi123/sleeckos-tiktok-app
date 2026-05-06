export const dynamic = "force-dynamic";
import { prisma } from "@/lib/db";
import { BadgeCheck } from "lucide-react";

export default async function AdminCreatorsPage() {
  const creators = await prisma.creatorProfile.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      user: {
        select: {
          email: true,
          status: true,
          tiktokAccount: {
            select: {
              username: true,
              followerCount: true,
              likesCount: true,
              videoCount: true,
              isVerified: true,
            },
          },
        },
      },
    },
  });

  const STATUS_COLORS: Record<string, string> = {
    APPROVED: "text-green-400 bg-green-400/10",
    PENDING: "text-yellow-400 bg-yellow-400/10",
    SUSPENDED: "text-red-400 bg-red-400/10",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Creators</h1>
        <span className="text-sm text-gray-500">{creators.length} total</span>
      </div>

      <div className="glass border border-white/5 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5">
              <th className="text-left px-4 py-3 text-gray-500 font-medium">Creator</th>
              <th className="text-left px-4 py-3 text-gray-500 font-medium">TikTok</th>
              <th className="text-right px-4 py-3 text-gray-500 font-medium">Followers</th>
              <th className="text-right px-4 py-3 text-gray-500 font-medium">Likes</th>
              <th className="text-right px-4 py-3 text-gray-500 font-medium">Videos</th>
              <th className="text-left px-4 py-3 text-gray-500 font-medium">Niches</th>
              <th className="text-left px-4 py-3 text-gray-500 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {creators.map((c) => {
              const tk = c.user.tiktokAccount;
              return (
                <tr key={c.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3">
                    <p className="text-white font-medium">{c.displayName}</p>
                    <p className="text-gray-600 text-xs">{c.user.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    {tk ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-gray-300">@{tk.username}</span>
                        {tk.isVerified && (
                          <BadgeCheck className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" aria-label="Verified" />
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-600 text-xs italic">Not connected</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {tk ? (
                      <span className="text-white font-medium">{tk.followerCount.toLocaleString()}</span>
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {tk ? (
                      <span className="text-gray-300">{tk.likesCount.toLocaleString()}</span>
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {tk ? (
                      <span className="text-gray-300">{tk.videoCount}</span>
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{c.nicheTags.slice(0, 3).join(", ") || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-1 rounded-full ${STATUS_COLORS[c.user.status] ?? "text-gray-400 bg-gray-400/10"}`}>
                      {c.user.status}
                    </span>
                  </td>
                </tr>
              );
            })}
            {creators.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-gray-600">No creators yet</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
