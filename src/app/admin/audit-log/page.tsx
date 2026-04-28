export const dynamic = "force-dynamic";
import { prisma } from "@/lib/db";

export default async function AdminAuditLogPage() {
  const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { actorUser: { select: { email: true } } } });
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Audit Log</h1>
        <p className="text-gray-500 text-sm mt-1">Immutable record of all platform actions and TikTok API calls</p>
      </div>
      <div className="glass border border-white/5 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-white/5"><th className="text-left px-4 py-3 text-gray-500 font-medium">Action</th><th className="text-left px-4 py-3 text-gray-500 font-medium">Actor</th><th className="text-left px-4 py-3 text-gray-500 font-medium">Resource</th><th className="text-left px-4 py-3 text-gray-500 font-medium">Time</th></tr></thead>
          <tbody>
            {logs.map((l)=>(
              <tr key={l.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                <td className="px-4 py-3 text-white font-mono text-xs">{l.action}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{l.actorUser?.email || "System"}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{l.resourceType}{l.resourceId ? ` · ${l.resourceId.slice(0,8)}` : ""}</td>
                <td className="px-4 py-3 text-gray-600 text-xs">{new Date(l.createdAt).toLocaleString()}</td>
              </tr>
            ))}
            {logs.length === 0 && <tr><td colSpan={4} className="px-4 py-12 text-center text-gray-600">No audit events yet</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
