export const dynamic = "force-dynamic";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Clock, CheckCircle, AlertCircle, ArrowRight } from "lucide-react";

export default async function ActiveWorkPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const deliverables = await prisma.deliverable.findMany({
    where: { creatorUserId: session.userId },
    include: { campaign: { include: { brand: true } } },
    orderBy: { updatedAt: "desc" }
  });

  return (
    <div className="space-y-8 pb-20">
      <div>
        <h1 className="text-3xl font-black text-white mb-2">Active Work</h1>
        <p className="text-gray-500">Manage your active campaigns and submit deliverables.</p>
      </div>

      {deliverables.length === 0 ? (
        <div className="glass border border-white/5 rounded-3xl p-12 text-center">
          <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Clock className="w-8 h-8 text-gray-600" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">No active work yet</h2>
          <p className="text-gray-500 mb-8 max-w-sm mx-auto">
            Apply to campaigns in the marketplace. Once a brand accepts your application, it will appear here.
          </p>
          <Link href="/c/campaigns" className="inline-flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white font-bold px-6 py-3 rounded-xl transition-all">
            Browse Marketplace <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {deliverables.map((d) => (
            <Link key={d.id} href={`/c/active/${d.id}`} className="glass border border-white/5 rounded-2xl p-6 flex items-center justify-between hover:border-purple-500/30 transition-all group">
              <div className="flex items-center gap-6">
                <div className="w-12 h-12 bg-purple-500/10 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                  {d.status === "PUBLISHED" ? <CheckCircle className="w-6 h-6 text-green-400" /> : <Clock className="w-6 h-6 text-purple-400" />}
                </div>
                <div>
                  <h3 className="text-white font-bold group-hover:text-purple-400 transition-colors">{d.campaign.title}</h3>
                  <p className="text-gray-500 text-sm">{d.campaign.brand.tradeName}</p>
                </div>
              </div>
              
              <div className="flex items-center gap-8 text-right">
                <div>
                  <p className="text-xs text-gray-600 uppercase tracking-wider mb-1">Status</p>
                  <span className={`text-xs font-bold px-2 py-1 rounded-md ${
                    d.status === "PUBLISHED" ? "bg-green-500/10 text-green-400" : "bg-purple-500/10 text-purple-400"
                  }`}>
                    {d.status.replace(/_/g, " ")}
                  </span>
                </div>
                <ArrowRight className="w-5 h-5 text-gray-700 group-hover:text-white group-hover:translate-x-1 transition-all" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
