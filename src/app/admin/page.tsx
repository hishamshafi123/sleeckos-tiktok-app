export const dynamic = "force-dynamic";
import prisma from "@/lib/db";
import Link from "next/link";
import { MonitorPlay, Clock, Film, Megaphone } from "lucide-react";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { redirect } from "next/navigation";

export default async function AdminDashboard() {
  const session = await getSession();
  if (!session) redirect("/login");

  const hasAccess = await can(session.userId, "overview");
  if (!hasAccess) {
    redirect("/admin/lms");
  }
  const [
    managedAccountCount,
    postQueueCount,
    sourcedVideoCount,
    campaignCount,
    recentPosts
  ] = await Promise.all([
    prisma.managedAccount.count(),
    prisma.scheduledPost.count({ where: { status: "QUEUED" } }),
    prisma.youTubeSourcedVideo.count({ where: { status: "NEW" } }),
    prisma.campaign.count(),
    prisma.scheduledPost.findMany({
      orderBy: { scheduledFor: "desc" },
      take: 10,
      include: { account: { select: { tiktokUsername: true } } },
    }),
  ]);

  const cards = [
    {
      label: "Managed Accounts",
      value: managedAccountCount,
      href: "/admin/accounts",
      icon: MonitorPlay,
      color: "text-blue-400",
      border: "border-blue-500/20",
      bg: "bg-blue-600/5",
    },
    {
      label: "Post Queue Size",
      value: postQueueCount,
      href: "/admin/accounts/queue",
      icon: Clock,
      color: "text-amber-400",
      border: "border-amber-500/20",
      bg: "bg-amber-500/5",
    },
    {
      label: "New Sourced Videos",
      value: sourcedVideoCount,
      href: "/admin/sourcing",
      icon: Film,
      color: "text-emerald-400",
      border: "border-emerald-500/20",
      bg: "bg-emerald-500/5",
    },
    {
      label: "Active Campaigns",
      value: campaignCount,
      href: "/admin/campaigns",
      icon: Megaphone,
      color: "text-purple-400",
      border: "border-purple-500/20",
      bg: "bg-purple-500/5",
    },
  ];

  return (
    <div className="space-y-6 text-zinc-100 bg-[#09090b]">
      {/* Header */}
      <div className="flex flex-col gap-1 border-b border-[#27272a] pb-5">
        <h1 className="text-xl font-bold tracking-tight">Admin Overview</h1>
        <p className="text-xs text-zinc-400">
          Review queue status, rendering loads, and internal operations performance.
        </p>
      </div>

      {/* Grid Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {cards.map((card, idx) => {
          const Icon = card.icon;
          return (
            <Link
              key={idx}
              href={card.href}
              className={`border rounded-md p-5 ${card.border} ${card.bg} hover:border-zinc-700 hover:bg-zinc-900/10 transition block`}
            >
              <div className="flex justify-between items-start">
                <span className="text-[10px] uppercase font-semibold text-zinc-500 tracking-wider">
                  {card.label}
                </span>
                <Icon className={`w-3.5 h-3.5 ${card.color}`} />
              </div>
              <div className="text-2xl font-bold tracking-tight mt-2">{card.value}</div>
            </Link>
          );
        })}
      </div>

      {/* Recent Queue Activity */}
      <div className="border border-[#27272a] rounded-md bg-[#09090b] p-4">
        <div className="flex justify-between items-center pb-3 border-b border-[#27272a] mb-4">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Recent Queue Activity
            </h2>
            <p className="text-[10px] text-zinc-500 mt-0.5">
              Real-time feed of automated and manual scheduling events.
            </p>
          </div>
          <Link
            href="/admin/accounts/queue"
            className="text-xs text-[#2563eb] hover:underline"
          >
            Full Queue →
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-[#27272a] text-zinc-500 font-semibold">
                <th className="py-2.5">Account</th>
                <th className="py-2.5">File Name / ID</th>
                <th className="py-2.5">Scheduled For</th>
                <th className="py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#27272a]">
              {recentPosts.map((post) => (
                <tr
                  key={post.id}
                  className="hover:bg-zinc-900/50 transition text-zinc-300"
                >
                  <td className="py-3 font-medium text-zinc-100">
                    @{post.account.tiktokUsername}
                  </td>
                  <td className="py-3 font-mono text-[10px] text-zinc-400">
                    {post.driveFileName || post.videoUrl || post.id}
                  </td>
                  <td className="py-3 text-zinc-500">
                    {new Date(post.scheduledFor).toLocaleString()}
                  </td>
                  <td className="py-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[9px] font-semibold border ${
                      post.status === "PUBLISHED" || post.status === "PENDING_DELETION" || post.status === "DELETED"
                        ? "bg-emerald-950/20 text-emerald-400 border-emerald-900/50"
                        : post.status === "FAILED"
                        ? "bg-red-950/20 text-red-400 border-red-900/50"
                        : post.status === "QUEUED" || post.status === "CLAIMED"
                        ? "bg-blue-950/20 text-blue-400 border-blue-900/50"
                        : "bg-zinc-950/20 text-zinc-400 border-zinc-900/50"
                      }`}
                    >
                      {post.status}
                    </span>
                  </td>
                </tr>
              ))}
              {recentPosts.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-zinc-500">
                    No recent queue activity.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
