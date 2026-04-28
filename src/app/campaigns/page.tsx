export const dynamic = "force-dynamic";
import PublicNav from "@/components/PublicNav";
import PublicFooter from "@/components/PublicFooter";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import Link from "next/link";
import { Search } from "lucide-react";

const DEMO = [
  { id:"d1", brand:"Lumina Beauty", logo:"L", category:"BEAUTY", title:"Skincare Glow-Up Routine", payout:350, spots:3, tags:["beauty","skincare"], deadline:"3 days", slug:"lumina-glow-up" },
  { id:"d2", brand:"TrailForge", logo:"T", category:"FITNESS", title:"Outdoor Adventure Gear Review", payout:500, spots:5, tags:["fitness","outdoor"], deadline:"5 days", slug:"trailforge-adventure" },
  { id:"d3", brand:"UrbanThreads", logo:"U", category:"FASHION", title:"OOTD Street Style", payout:280, spots:8, tags:["fashion","lifestyle"], deadline:"7 days", slug:"urbanthreads-ootd" },
  { id:"d4", brand:"BrewHaus Coffee", logo:"B", category:"FOOD", title:"Morning Ritual with BrewHaus", payout:200, spots:10, tags:["food","lifestyle"], deadline:"10 days", slug:"brewhaus-morning" },
  { id:"d5", brand:"NovaTech", logo:"N", category:"TECH", title:"Unboxing & First Impressions", payout:450, spots:4, tags:["tech"], deadline:"4 days", slug:"novatech-unboxing" },
  { id:"d6", brand:"WanderJet", logo:"W", category:"TRAVEL", title:"Packing Essentials for Solo Travel", payout:600, spots:2, tags:["travel","lifestyle"], deadline:"6 days", slug:"wanderjet-packing" },
  { id:"d7", brand:"GlowFit", logo:"G", category:"FITNESS", title:"Morning Workout Routine", payout:320, spots:6, tags:["fitness","health"], deadline:"8 days", slug:"glowfit-workout" },
  { id:"d8", brand:"Aura Cosmetics", logo:"A", category:"BEAUTY", title:"Get Ready With Me", payout:275, spots:12, tags:["beauty","grwm"], deadline:"12 days", slug:"aura-grwm" },
  { id:"d9", brand:"CloudWear", logo:"C", category:"FASHION", title:"Cozy Work From Home Fits", logo2:"C", payout:230, spots:15, tags:["fashion","wfh"], deadline:"14 days", slug:"cloudwear-wfh" },
];

const CAT_COLORS: Record<string,string> = {
  BEAUTY:"text-pink-400 bg-pink-400/10", FITNESS:"text-green-400 bg-green-400/10",
  FASHION:"text-yellow-400 bg-yellow-400/10", FOOD:"text-orange-400 bg-orange-400/10",
  TECH:"text-blue-400 bg-blue-400/10", TRAVEL:"text-cyan-400 bg-cyan-400/10",
  LIFESTYLE:"text-purple-400 bg-purple-400/10",
};

export default async function CampaignsPage() {
  const session = await getSession();
  return (
    <div className="min-h-screen">
      <PublicNav session={session} />
      <div className="pt-24 pb-20 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="mb-10">
            <h1 className="text-4xl font-bold text-white mb-3">Open Campaigns</h1>
            <p className="text-gray-500 max-w-xl">Browse paid UGC campaigns from verified brands. All posts include mandatory TikTok Branded Content disclosure.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {DEMO.map((c) => (
              <Link key={c.id} href={session ? "/c/campaigns" : "/signup/creator"} className="glass rounded-2xl p-5 hover:border-purple-500/30 border border-white/5 transition-all hover:shadow-lg hover:shadow-purple-500/10 group block">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center text-purple-300 font-bold text-sm">{c.logo}</div>
                  <span className={`text-xs font-semibold px-2 py-1 rounded-full ${CAT_COLORS[c.category]}`}>{c.category}</span>
                </div>
                <p className="text-xs text-gray-500 mb-1">{c.brand}</p>
                <h3 className="font-semibold text-white mb-3 group-hover:text-purple-300 transition-colors">{c.title}</h3>
                <div className="flex items-center gap-2 flex-wrap mb-4">
                  {c.tags.map((t) => <span key={t} className="text-xs text-gray-500 bg-white/5 px-2 py-0.5 rounded-full">#{t}</span>)}
                </div>
                <div className="flex items-center justify-between pt-3 border-t border-white/5">
                  <span className="text-green-400 font-bold">${c.payout}</span>
                  <span className="text-xs text-gray-500">{c.spots} spots · {c.deadline}</span>
                </div>
                <div className="mt-3 text-xs text-purple-400/70 flex items-center gap-1">🔒 Paid partnership disclosure enforced</div>
              </Link>
            ))}
          </div>

          <div className="mt-12 glass border border-purple-500/20 rounded-2xl p-6 text-center">
            <p className="text-gray-400 text-sm">
              All campaign posts on Sleeckos are published as <strong className="text-white">&ldquo;Paid partnership&rdquo;</strong> in compliance with TikTok&apos;s Branded Content Policy and the FTC Endorsement Guides. Creators retain full creative control and ownership of their original content.
            </p>
          </div>
        </div>
      </div>
      <PublicFooter />
    </div>
  );
}
