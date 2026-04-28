import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Shield, Users, DollarSign, Calendar, ArrowLeft, Send } from "lucide-react";
import ApplicationForm from "@/components/ApplicationForm";

// Demo data for testing before DB has campaigns
const DEMO_CAMPAIGNS: any = {
  "d1": {
    id: "d1",
    title: "Skincare Glow-Up Routine",
    brand: { tradeName: "Lumina Beauty" },
    description: "Create a 15-30s high-energy video demonstrating your evening skincare routine using our Glow Serum.",
    brief: "Start with a close-up of your face, then show the product, apply it, and show the 'glow' effect with good lighting. Mention the 20% discount code GLOW20 in the caption.",
    payoutPerPostCents: 35000,
    maxCreators: 3,
    applicationDeadline: new Date(Date.now() + 86400000 * 3),
    nicheTags: ["beauty", "skincare"],
    category: "BEAUTY"
  },
  "d2": {
    id: "d2",
    title: "Outdoor Adventure Gear Review",
    brand: { tradeName: "TrailForge" },
    description: "Review our new ultra-light backpack during an actual hike.",
    brief: "Show the backpack in use on a trail. Highlight the waterproof material and the comfortable straps. Be authentic and talk about your experience.",
    payoutPerPostCents: 50000,
    maxCreators: 5,
    applicationDeadline: new Date(Date.now() + 86400000 * 5),
    nicheTags: ["fitness", "outdoor"],
    category: "FITNESS"
  }
};

export default async function CampaignDetailPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;
  
  let campaign: any = await prisma.campaign.findUnique({
    where: { id },
    include: { brand: true }
  });

  // Fallback to demo data if not found in DB
  if (!campaign && DEMO_CAMPAIGNS[id]) {
    campaign = DEMO_CAMPAIGNS[id];
  }

  if (!campaign) notFound();

  const existingApplication = await prisma.application.findUnique({
    where: { campaignId_creatorUserId: { campaignId: id, creatorUserId: session.userId } }
  });

  return (
    <div className="space-y-8 pb-20">
      <Link href="/c/campaigns" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-white transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Back to campaigns
      </Link>

      <div className="flex flex-col md:flex-row gap-8">
        {/* Main Content */}
        <div className="flex-1 space-y-8">
          <div>
            <div className="flex items-center gap-2 text-purple-400 text-sm font-medium mb-3">
              <Shield className="w-4 h-4" />
              Verified Brand Campaign
            </div>
            <h1 className="text-3xl font-black text-white mb-2">{campaign.title}</h1>
            <p className="text-gray-500">by {campaign.brand.tradeName}</p>
          </div>

          <div className="glass border border-white/5 rounded-3xl p-8 space-y-6">
            <section>
              <h3 className="text-white font-bold mb-3">Description</h3>
              <p className="text-gray-400 leading-relaxed">{campaign.description}</p>
            </section>
            
            <section className="bg-purple-500/5 border border-purple-500/10 rounded-2xl p-6">
              <h3 className="text-purple-300 font-bold mb-3 flex items-center gap-2">
                <Zap className="w-4 h-4" />
                The Brief
              </h3>
              <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">{campaign.brief}</p>
            </section>
          </div>
        </div>

        {/* Sidebar / Apply */}
        <div className="w-full md:w-80 space-y-6">
          <div className="glass border border-white/5 rounded-3xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <span className="text-gray-500 text-sm">Payout</span>
              <span className="text-green-400 font-bold text-xl">${(campaign.payoutPerPostCents / 100).toFixed(0)}</span>
            </div>
            
            <div className="space-y-3 pt-3 border-t border-white/5">
              <div className="flex items-center gap-3 text-sm">
                <Users className="w-4 h-4 text-purple-400" />
                <span className="text-gray-400">{campaign.maxCreators} creator spots</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Calendar className="w-4 h-4 text-purple-400" />
                <span className="text-gray-400">Deadline: {new Date(campaign.applicationDeadline).toLocaleDateString()}</span>
              </div>
            </div>

            {existingApplication ? (
              <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 text-center">
                <p className="text-green-400 text-sm font-bold flex items-center justify-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Application Sent
                </p>
                <p className="text-xs text-gray-500 mt-1">Status: {existingApplication.status}</p>
              </div>
            ) : (
              <ApplicationForm campaignId={campaign.id} />
            )}
          </div>

          <div className="glass border border-white/5 rounded-3xl p-6">
            <h4 className="text-white font-bold text-sm mb-4">Requirements</h4>
            <ul className="space-y-3">
              <li className="flex items-start gap-2 text-xs text-gray-500">
                <div className="w-1.5 h-1.5 rounded-full bg-purple-500 mt-1 flex-shrink-0" />
                Original TikTok video content only
              </li>
              <li className="flex items-start gap-2 text-xs text-gray-500">
                <div className="w-1.5 h-1.5 rounded-full bg-purple-500 mt-1 flex-shrink-0" />
                Mandatory Branded Content disclosure
              </li>
              <li className="flex items-start gap-2 text-xs text-gray-500">
                <div className="w-1.5 h-1.5 rounded-full bg-purple-500 mt-1 flex-shrink-0" />
                Rights granted to brand for 12 months
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function Zap({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  );
}

function CheckCircle2({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}
