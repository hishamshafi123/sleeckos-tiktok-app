export const dynamic = "force-dynamic";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Shield, Zap, TrendingUp } from "lucide-react";

export default async function CreatorOnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen grid-bg flex flex-col items-center justify-center px-4 py-20">
      <div className="max-w-2xl w-full text-center mb-12">
        <div className="inline-flex items-center gap-2 bg-purple-500/10 border border-purple-500/20 rounded-full px-4 py-1.5 text-purple-300 text-sm font-medium mb-6 animate-float">
          <Shield className="w-3.5 h-3.5" />
          Identity verified
        </div>
        <h1 className="text-4xl sm:text-5xl font-black text-white mb-6 tracking-tight">
          Welcome to the <span className="gradient-text">Creator Marketplace</span>
        </h1>
        <p className="text-gray-500 text-lg leading-relaxed">
          One final step to unlock paid campaigns: connect your TikTok account so brands can verify your content style and niches.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6 max-w-4xl w-full mb-12">
        <div className="glass border border-white/5 rounded-3xl p-8 hover:border-purple-500/30 transition-all group">
          <div className="w-12 h-12 bg-purple-500/10 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
            <Zap className="w-6 h-6 text-purple-400" />
          </div>
          <h3 className="text-white font-bold text-lg mb-2">Apply to Campaigns</h3>
          <p className="text-gray-500 text-sm leading-relaxed">
            Get instant access to open briefs from verified brands looking for your specific niche.
          </p>
        </div>
        <div className="glass border border-white/5 rounded-3xl p-8 hover:border-purple-500/30 transition-all group">
          <div className="w-12 h-12 bg-purple-500/10 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
            <TrendingUp className="w-6 h-6 text-purple-400" />
          </div>
          <h3 className="text-white font-bold text-lg mb-2">Guaranteed Payouts</h3>
          <p className="text-gray-500 text-sm leading-relaxed">
            No more chasing invoices. Once your post is approved and published, your flat fee is locked in.
          </p>
        </div>
      </div>

      <div className="max-w-md w-full glass border border-purple-500/20 rounded-3xl p-10 text-center glow-purple relative overflow-hidden">
        <div className="absolute top-0 right-0 p-4">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
        </div>
        
        <h2 className="text-xl font-bold text-white mb-8">Connect your account</h2>
        
        <Link 
          href="/api/auth/tiktok" 
          className="w-full bg-[#000] text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-3 hover:bg-zinc-900 transition-all border border-white/10 group active:scale-95 shadow-xl"
        >
          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
            <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V9.41a8.16 8.16 0 0 0 4.77 1.52V7.49a4.85 4.85 0 0 1-1-.8z"/>
          </svg>
          Connect with TikTok
        </Link>
        
        <p className="text-xs text-gray-600 mt-6 leading-relaxed">
          By connecting, you agree to publish all campaign deliverables with TikTok&apos;s Branded Content disclosure enabled. Disclosure is mandatory.
        </p>
      </div>

      <div className="mt-12 flex items-center gap-6 text-sm text-gray-500">
        <span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-500" /> Vetted brands</span>
        <span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-500" /> Secure payouts</span>
        <span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-500" /> 100% Compliant</span>
      </div>
    </div>
  );
}
