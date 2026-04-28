export const dynamic = "force-dynamic";
import PublicNav from "@/components/PublicNav";
import PublicFooter from "@/components/PublicFooter";
import { getSession } from "@/lib/session";
import Link from "next/link";

export default async function ForCreatorsPage() {
  const session = await getSession();
  return (
    <div className="min-h-screen">
      <PublicNav session={session} />
      <div className="pt-32 pb-20 px-4 max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-white mb-6">For Creators</h1>
        <p className="text-gray-400 text-lg leading-relaxed mb-10">
          Join Sleeckos and monetize your TikTok content through transparent paid campaigns with verified brands. Every campaign comes with a flat fee, brand approval process, and mandatory Branded Content disclosure — no grey areas.
        </p>
        <div className="grid md:grid-cols-3 gap-6 mb-12">
          {[
            ["Apply & verify", "Connect your TikTok, complete your profile, agree to disclosure terms. Get approved within 48 hours."],
            ["Create original content", "Browse campaigns, pitch yourself, film your own video once accepted, upload for brand review."],
            ["Publish & get paid", "Use our compliant publisher with disclosure locked on. Flat fee paid via Stripe."],
          ].map(([t, d], i) => (
            <div key={i} className="glass border border-white/5 rounded-2xl p-6">
              <div className="text-3xl font-black text-purple-400 mb-3">{i + 1}</div>
              <h3 className="font-bold text-white mb-2">{t}</h3>
              <p className="text-gray-500 text-sm">{d}</p>
            </div>
          ))}
        </div>
        <Link href="/signup/creator" className="bg-purple-600 hover:bg-purple-500 text-white font-bold px-8 py-4 rounded-xl text-lg transition-all inline-block">
          Apply as a creator →
        </Link>
      </div>
      <PublicFooter />
    </div>
  );
}
