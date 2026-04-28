export const dynamic = "force-dynamic";
import { prisma } from "@/lib/db";

export default async function AdminCampaignsPage() {
  const campaigns = await prisma.campaign.findMany({ orderBy: { createdAt: "desc" }, include: { brand: true } });
  const STATUS_COLORS: Record<string,string> = { DRAFT:"text-gray-400 bg-gray-400/10", PENDING_REVIEW:"text-yellow-400 bg-yellow-400/10", OPEN:"text-green-400 bg-green-400/10", CLOSED:"text-gray-400 bg-gray-400/10", COMPLETED:"text-blue-400 bg-blue-400/10", CANCELLED:"text-red-400 bg-red-400/10" };
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">All Campaigns</h1>
      <div className="glass border border-white/5 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-white/5"><th className="text-left px-4 py-3 text-gray-500 font-medium">Campaign</th><th className="text-left px-4 py-3 text-gray-500 font-medium">Brand</th><th className="text-left px-4 py-3 text-gray-500 font-medium">Payout</th><th className="text-left px-4 py-3 text-gray-500 font-medium">Status</th></tr></thead>
          <tbody>
            {campaigns.map((c)=>(
              <tr key={c.id} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-3 text-white font-medium">{c.title}</td>
                <td className="px-4 py-3 text-gray-500">{c.brand.tradeName}</td>
                <td className="px-4 py-3 text-green-400 font-semibold">${(c.payoutPerPostCents/100).toFixed(0)}</td>
                <td className="px-4 py-3"><span className={`text-xs font-semibold px-2 py-1 rounded-full ${STATUS_COLORS[c.status]}`}>{c.status}</span></td>
              </tr>
            ))}
            {campaigns.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-600">No campaigns yet</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
