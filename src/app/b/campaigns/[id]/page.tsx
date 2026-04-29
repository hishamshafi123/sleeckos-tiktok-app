export const dynamic = "force-dynamic";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Users, ExternalLink, Calendar, CheckCircle } from "lucide-react";
import BrandApplicationCard from "@/components/BrandApplicationCard";

export default async function BrandCampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "BRAND_OWNER") redirect("/login");

  const { id } = await params;

  const brand = await prisma.brand.findUnique({
    where: { ownerUserId: session.userId },
  });

  if (!brand) redirect("/b/onboarding");

  const campaign = await prisma.campaign.findUnique({
    where: { id, brandId: brand.id },
    include: {
      applications: {
        include: {
          creatorUser: { include: { creatorProfile: true } },
          deliverable: true,
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!campaign) notFound();

  return (
    <div className="space-y-8 pb-20">
      <Link href="/b/campaigns" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-white transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Back to campaigns
      </Link>

      <div className="flex flex-col md:flex-row gap-8">
        <div className="flex-1 space-y-6">
          <div>
            <h1 className="text-3xl font-black text-white mb-2">{campaign.title}</h1>
            <div className="flex items-center gap-4 text-sm text-gray-400">
              <span className={`px-2 py-1 rounded text-xs font-bold ${
                campaign.status === "OPEN" ? "bg-green-500/10 text-green-400" : "bg-yellow-500/10 text-yellow-400"
              }`}>
                {campaign.status}
              </span>
              <span className="flex items-center gap-1"><Calendar className="w-4 h-4" /> Deadline: {new Date(campaign.applicationDeadline).toLocaleDateString()}</span>
            </div>
          </div>

          <div className="glass border border-white/5 rounded-3xl p-8 space-y-6">
            <div>
              <h3 className="text-white font-bold mb-2">Description</h3>
              <p className="text-gray-400 text-sm leading-relaxed">{campaign.description}</p>
            </div>
            <div className="pt-4 border-t border-white/5">
              <h3 className="text-white font-bold mb-2">The Brief</h3>
              <p className="text-gray-400 text-sm leading-relaxed whitespace-pre-wrap">{campaign.brief}</p>
            </div>
          </div>
        </div>

        <div className="w-full md:w-80 space-y-6">
          <div className="glass border border-white/5 rounded-3xl p-6 space-y-4">
            <h3 className="text-white font-bold flex items-center gap-2 mb-4">
              <Users className="w-4 h-4 text-purple-400" />
              Creator Applications
            </h3>

            {campaign.applications.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">No applications yet.</p>
            ) : (
              <div className="space-y-3">
                {campaign.applications.map((app) => (
                  <BrandApplicationCard key={app.id} application={app} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
