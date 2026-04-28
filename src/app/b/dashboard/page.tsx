export const dynamic = "force-dynamic";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import Link from "next/link";
import { Plus, Megaphone, Clock, CheckCircle2 } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "text-gray-400 bg-gray-400/10",
  PENDING_REVIEW: "text-yellow-400 bg-yellow-400/10",
  OPEN: "text-green-400 bg-green-400/10",
  CLOSED: "text-gray-400 bg-gray-400/10",
  COMPLETED: "text-blue-400 bg-blue-400/10",
  CANCELLED: "text-red-400 bg-red-400/10",
};

export default async function BrandDashboard() {
  const session = await getSession();
  if (!session) return null;

  const brand = await prisma.brand.findUnique({ where: { ownerUserId: session.userId } });
  if (!brand) return <div className="text-gray-500">Brand profile not found.</div>;

  const campaigns = await prisma.campaign.findMany({
    where: { brandId: brand.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { applications: true, deliverables: true } } },
  });

  if (brand.status === "PENDING") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center max-w-md">
          <Clock className="w-12 h-12 text-amber-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">Pending approval</h2>
          <p className="text-gray-500 text-sm leading-relaxed">Your brand registration is under review. We&apos;ll email you at <strong className="text-white">{brand.contactEmail}</strong> within 2-3 business days.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">{brand.tradeName}</h1>
          <p className="text-gray-500 mt-1">Brand dashboard</p>
        </div>
        <Link href="/b/campaigns/new" className="bg-purple-600 hover:bg-purple-500 text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-all flex items-center gap-2">
          <Plus className="w-4 h-4" />
          New Campaign
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Active campaigns", value: campaigns.filter((c) => c.status === "OPEN").length },
          { label: "Total applications", value: campaigns.reduce((s, c) => s + c._count.applications, 0) },
          { label: "Published posts", value: campaigns.reduce((s, c) => s + c._count.deliverables, 0) },
        ].map(({ label, value }) => (
          <div key={label} className="glass border border-white/5 rounded-2xl p-5">
            <div className="text-2xl font-bold text-white">{value}</div>
            <div className="text-xs text-gray-500 mt-1">{label}</div>
          </div>
        ))}
      </div>

      {/* Campaigns */}
      <div>
        <h2 className="font-semibold text-white mb-4">Your Campaigns</h2>
        {campaigns.length === 0 ? (
          <div className="glass border border-white/5 rounded-2xl p-12 text-center">
            <Megaphone className="w-8 h-8 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500 mb-4">No campaigns yet</p>
            <Link href="/b/campaigns/new" className="bg-purple-600 hover:bg-purple-500 text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-all inline-block">
              Create your first campaign →
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {campaigns.map((c) => (
              <Link key={c.id} href={`/b/campaigns/${c.id}`} className="glass border border-white/5 rounded-xl p-5 flex items-center justify-between hover:border-purple-500/30 transition-all group block">
                <div>
                  <p className="font-medium text-white group-hover:text-purple-300 transition-colors">{c.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{c._count.applications} applications · {c._count.deliverables} deliverables</p>
                </div>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_COLORS[c.status]}`}>{c.status}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
