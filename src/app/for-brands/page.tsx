export const dynamic = "force-dynamic";
import PublicNav from "@/components/PublicNav";
import PublicFooter from "@/components/PublicFooter";
import { getSession } from "@/lib/session";
import Link from "next/link";

export default async function ForBrandsPage() {
  const session = await getSession();
  return (
    <div className="min-h-screen">
      <PublicNav session={session} />
      <div className="pt-32 pb-20 px-4 max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-white mb-6">For Brands</h1>
        <p className="text-gray-400 text-lg leading-relaxed mb-10">
          Commission original UGC from vetted TikTok creators. Every deliverable is published with TikTok Branded Content disclosure automatically — full compliance built in from the start.
        </p>
        <div className="grid md:grid-cols-3 gap-6 mb-12">
          {[
            ["Apply & get verified", "Register your brand, pass our manual review. We block restricted categories per TikTok's Branded Content Policy."],
            ["Post a campaign brief", "Describe your product, set a budget, define deliverables. We route it to matching creators."],
            ["Review, approve & publish", "Review applications and drafts. Approved videos publish with disclosure automatically enforced."],
          ].map(([t, d], i) => (
            <div key={i} className="glass border border-white/5 rounded-2xl p-6">
              <div className="text-3xl font-black text-purple-400 mb-3">{i + 1}</div>
              <h3 className="font-bold text-white mb-2">{t}</h3>
              <p className="text-gray-500 text-sm">{d}</p>
            </div>
          ))}
        </div>
        <Link href="/signup/brand" className="bg-purple-600 hover:bg-purple-500 text-white font-bold px-8 py-4 rounded-xl text-lg transition-all inline-block">
          Register your brand →
        </Link>
      </div>
      <PublicFooter />
    </div>
  );
}
