export const dynamic = "force-dynamic";
import PublicNav from "@/components/PublicNav";
import PublicFooter from "@/components/PublicFooter";
import { getSession } from "@/lib/session";

export default async function AboutPage() {
  const session = await getSession();
  return (
    <div className="min-h-screen">
      <PublicNav session={session} />
      <div className="pt-32 pb-20 px-4 max-w-3xl mx-auto space-y-6">
        <h1 className="text-4xl font-bold text-white">About Sleeckos</h1>
        <p className="text-gray-400 text-lg leading-relaxed">
          Sleeckos is a UGC creator marketplace built specifically for transparent, TikTok-compliant branded content campaigns. We connect verified brands with vetted independent creators who produce original content always published with proper Branded Content disclosure.
        </p>
        <p className="text-gray-400 leading-relaxed">
          Our platform enforces TikTok&apos;s Branded Content Policy at the infrastructure level — the &ldquo;Paid partnership&rdquo; disclosure cannot be turned off by creators or brands. Every post is a transparent paid partnership, period.
        </p>
      </div>
      <PublicFooter />
    </div>
  );
}
