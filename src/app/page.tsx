export const dynamic = "force-dynamic";
import { getSession } from "@/lib/session";
import PublicNav from "@/components/PublicNav";
import PublicFooter from "@/components/PublicFooter";
import Link from "next/link";
import { CheckCircle2, DollarSign, Shield, TrendingUp, Users, Zap } from "lucide-react";

const DEMO_CAMPAIGNS = [
  { id: "1", brand: "Lumina Beauty", category: "BEAUTY", title: "Skincare Glow-Up Routine", payout: 350, spots: 3, tags: ["beauty", "skincare"], deadline: "3 days" },
  { id: "2", brand: "TrailForge", category: "FITNESS", title: "Outdoor Adventure Gear Review", payout: 500, spots: 5, tags: ["fitness", "outdoor"], deadline: "5 days" },
  { id: "3", brand: "UrbanThreads", category: "FASHION", title: "OOTD Street Style", payout: 280, spots: 8, tags: ["fashion", "lifestyle"], deadline: "7 days" },
  { id: "4", brand: "BrewHaus Coffee", category: "FOOD", title: "Morning Ritual with BrewHaus", payout: 200, spots: 10, tags: ["food", "lifestyle"], deadline: "10 days" },
  { id: "5", brand: "NovaTech", category: "TECH", title: "Unboxing & First Impressions", payout: 450, spots: 4, tags: ["tech"], deadline: "4 days" },
  { id: "6", brand: "WanderJet", category: "TRAVEL", title: "Packing Essentials for Solo Travel", payout: 600, spots: 2, tags: ["travel", "lifestyle"], deadline: "6 days" },
];

const CATEGORY_COLORS: Record<string, string> = {
  BEAUTY: "text-pink-400 bg-pink-400/10",
  FITNESS: "text-green-400 bg-green-400/10",
  FASHION: "text-yellow-400 bg-yellow-400/10",
  FOOD: "text-orange-400 bg-orange-400/10",
  TECH: "text-blue-400 bg-blue-400/10",
  TRAVEL: "text-cyan-400 bg-cyan-400/10",
};

export default async function HomePage() {
  const session = await getSession();

  return (
    <div className="min-h-screen">
      <PublicNav session={session} />

      {/* Hero */}
      <section className="relative pt-32 pb-24 px-4 overflow-hidden grid-bg">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl animate-pulse-slow" />
          <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-violet-600/10 rounded-full blur-3xl animate-pulse-slow" style={{ animationDelay: "2s" }} />
        </div>

        <div className="max-w-5xl mx-auto text-center relative">
          <div className="inline-flex items-center gap-2 bg-purple-500/10 border border-purple-500/20 rounded-full px-4 py-1.5 text-purple-300 text-sm font-medium mb-8">
            <Shield className="w-3.5 h-3.5" />
            100% TikTok Branded Content Policy compliant
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black tracking-tight mb-6 leading-tight">
            Paid campaigns.<br />
            <span className="gradient-text">Original creators.</span><br />
            Proper disclosure.
          </h1>

          <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            Sleeckos connects verified brands with vetted TikTok creators for transparent paid UGC campaigns — with TikTok&apos;s &ldquo;Paid partnership&rdquo; disclosure enforced on every single post.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/signup/creator" className="bg-purple-600 hover:bg-purple-500 text-white font-bold px-8 py-4 rounded-xl text-lg transition-all hover:scale-105 hover:shadow-lg hover:shadow-purple-500/25">
              Apply as a Creator →
            </Link>
            <Link href="/signup/brand" className="glass border border-white/10 hover:border-purple-500/40 text-white font-bold px-8 py-4 rounded-xl text-lg transition-all">
              Register your Brand
            </Link>
          </div>

          <div className="flex items-center justify-center gap-8 mt-12 text-sm text-gray-500">
            <span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-400" /> No hidden fees</span>
            <span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-400" /> Disclosure enforced</span>
            <span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-400" /> Admin-reviewed brands</span>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-16 px-4 border-y border-white/5">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {[
            ["500+", "Vetted Creators"],
            ["50+", "Brand Partners"],
            ["$2.4M", "Paid to Creators"],
            ["100%", "Disclosure Rate"],
          ].map(([val, label]) => (
            <div key={label}>
              <div className="text-3xl font-black gradient-text mb-1">{val}</div>
              <div className="text-gray-500 text-sm">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Live campaigns preview */}
      <section className="py-20 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-end justify-between mb-10">
            <div>
              <h2 className="text-3xl font-bold text-white mb-2">Open Campaigns</h2>
              <p className="text-gray-500">Apply to work with top brands. All posts include mandatory Branded Content disclosure.</p>
            </div>
            <Link href="/campaigns" className="text-purple-400 hover:text-purple-300 font-medium text-sm transition-colors">
              View all →
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {DEMO_CAMPAIGNS.map((c) => (
              <Link
                key={c.id}
                href="/campaigns"
                className="glass rounded-2xl p-5 hover:border-purple-500/30 border border-white/5 transition-all hover:shadow-lg hover:shadow-purple-500/10 group block"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center text-purple-300 font-bold text-sm">
                    {c.brand[0]}
                  </div>
                  <span className={`text-xs font-semibold px-2 py-1 rounded-full ${CATEGORY_COLORS[c.category]}`}>
                    {c.category}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mb-1">{c.brand}</p>
                <h3 className="font-semibold text-white mb-3 group-hover:text-purple-300 transition-colors">{c.title}</h3>
                <div className="flex items-center gap-2 flex-wrap mb-4">
                  {c.tags.map((t) => (
                    <span key={t} className="text-xs text-gray-500 bg-white/5 px-2 py-0.5 rounded-full">#{t}</span>
                  ))}
                </div>
                <div className="flex items-center justify-between pt-3 border-t border-white/5">
                  <span className="text-green-400 font-bold">${c.payout}</span>
                  <span className="text-xs text-gray-500">{c.spots} spots · {c.deadline}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-20 px-4 bg-white/[0.02]">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-white text-center mb-4">How it works</h2>
          <p className="text-gray-500 text-center mb-16">For creators, it&apos;s three steps. Fully transparent paid content, every time.</p>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              { icon: Users, title: "Apply & get verified", desc: "Connect your TikTok, fill in your niche and past content, agree to disclosure terms. We review and approve within 48 hours." },
              { icon: Zap, title: "Accept a campaign & create", desc: "Browse open campaigns, send a pitch, film your original video once accepted. Upload a draft for brand review." },
              { icon: DollarSign, title: "Publish & get paid", desc: "Publish through our TikTok-compliant composer with Branded Content disclosure locked on. Flat fee deposited to your Stripe account." },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="glass rounded-2xl p-6 border border-white/5">
                <div className="w-12 h-12 bg-purple-500/20 rounded-xl flex items-center justify-center mb-4">
                  <Icon className="w-6 h-6 text-purple-400" />
                </div>
                <h3 className="font-bold text-white mb-2">{title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Compliance callout */}
      <section className="py-20 px-4">
        <div className="max-w-3xl mx-auto glass rounded-3xl p-10 border border-purple-500/20 text-center glow-purple">
          <Shield className="w-10 h-10 text-purple-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-4">
            Built around TikTok&apos;s Branded Content Policy
          </h2>
          <p className="text-gray-400 leading-relaxed mb-6">
            Every campaign post on Sleeckos is published with TikTok&apos;s Branded Content disclosure as &ldquo;Paid partnership&rdquo; in compliance with TikTok&apos;s Branded Content Policy and the FTC Endorsement Guides. Creators retain full creative control and ownership of their original content. Disclosure cannot be disabled — by anyone.
          </p>
          <Link href="/branded-content-policy" className="text-purple-400 hover:text-purple-300 text-sm font-medium transition-colors">
            Read our Branded Content Policy →
          </Link>
        </div>
      </section>

      {/* Dual CTA */}
      <section className="py-20 px-4">
        <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-6">
          <div className="glass rounded-3xl p-8 border border-white/5 hover:border-purple-500/30 transition-all">
            <TrendingUp className="w-8 h-8 text-purple-400 mb-4" />
            <h3 className="text-xl font-bold text-white mb-2">For Creators</h3>
            <p className="text-gray-500 text-sm mb-6 leading-relaxed">Monetize your content with transparent paid campaigns from verified brands. No fake reviews, no undisclosed ads.</p>
            <Link href="/for-creators" className="bg-purple-600 hover:bg-purple-500 text-white font-semibold px-6 py-3 rounded-xl text-sm transition-all inline-block">
              Learn more →
            </Link>
          </div>
          <div className="glass rounded-3xl p-8 border border-white/5 hover:border-purple-500/30 transition-all">
            <Shield className="w-8 h-8 text-purple-400 mb-4" />
            <h3 className="text-xl font-bold text-white mb-2">For Brands</h3>
            <p className="text-gray-500 text-sm mb-6 leading-relaxed">Run UGC campaigns that are fully compliant with TikTok&apos;s Branded Content Policy from day one. No grey areas.</p>
            <Link href="/for-brands" className="bg-white/10 hover:bg-white/15 text-white font-semibold px-6 py-3 rounded-xl text-sm transition-all inline-block border border-white/10">
              Learn more →
            </Link>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
