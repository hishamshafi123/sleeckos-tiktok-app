export const dynamic = "force-dynamic";
import { prisma } from "@/lib/db";
import Link from "next/link";
import { Clock, Users, Megaphone, CheckCircle2 } from "lucide-react";

export default async function AdminDashboard() {
  const [pendingBrands, pendingCreators, pendingCampaigns, recentLogs] = await Promise.all([
    prisma.brand.count({ where: { status: "PENDING" } }),
    prisma.creatorProfile.count({ where: { approvedAt: null } }),
    prisma.campaign.count({ where: { status: "PENDING_REVIEW" } }),
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 10, include: { actorUser: { select: { email: true } } } }),
  ]);

  const queues = [
    { label: "Brands awaiting review", value: pendingBrands, href: "/admin/brands", color: "text-amber-400", bg: "bg-amber-400/10 border-amber-500/20" },
    { label: "Creators awaiting review", value: pendingCreators, href: "/admin/creators", color: "text-purple-400", bg: "bg-purple-400/10 border-purple-500/20" },
    { label: "Campaigns awaiting review", value: pendingCampaigns, href: "/admin/campaigns", color: "text-blue-400", bg: "bg-blue-400/10 border-blue-500/20" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Admin Overview</h1>
        <p className="text-gray-500 mt-1">Review queues and platform activity</p>
      </div>

      {/* Queue cards */}
      <div className="grid grid-cols-3 gap-4">
        {queues.map(({ label, value, href, color, bg }) => (
          <Link key={label} href={href} className={`glass border rounded-2xl p-6 ${bg} hover:scale-105 transition-all block`}>
            <div className={`text-3xl font-black mb-1 ${color}`}>{value}</div>
            <div className="text-sm text-gray-400">{label}</div>
            <div className={`text-xs mt-2 ${color}`}>Review now →</div>
          </Link>
        ))}
      </div>

      {/* Recent audit log */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-white">Recent Activity</h2>
          <Link href="/admin/audit-log" className="text-sm text-amber-400 hover:text-amber-300">Full audit log →</Link>
        </div>
        <div className="glass border border-white/5 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Action</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Actor</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Resource</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {recentLogs.map((log) => (
                <tr key={log.id} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-3 text-white font-mono text-xs">{log.action}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{log.actorUser?.email || "System"}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{log.resourceType}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{new Date(log.createdAt).toLocaleString()}</td>
                </tr>
              ))}
              {recentLogs.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-600">No activity yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
