export const dynamic = "force-dynamic";
import PublicNav from "@/components/PublicNav";
import PublicFooter from "@/components/PublicFooter";
import { getSession } from "@/lib/session";

export default async function BrandedContentPolicyPage() {
  const session = await getSession();
  return (
    <div className="min-h-screen">
      <PublicNav session={session} />
      <div className="pt-32 pb-20 px-4 max-w-3xl mx-auto space-y-8">
        <h1 className="text-4xl font-bold text-white">Branded Content Policy</h1>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-white">Mandatory Disclosure</h2>
          <p className="text-gray-400 leading-relaxed">Every campaign post published through Sleeckos uses <code className="text-purple-300 bg-purple-500/10 px-1.5 py-0.5 rounded text-sm">brand_content_toggle: true</code> in the TikTok Content Posting API. This applies TikTok&apos;s &ldquo;Paid partnership&rdquo; label automatically. This setting cannot be disabled by creators or brands — ever.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-white">Restricted Categories</h2>
          <p className="text-gray-400 leading-relaxed">We block campaign submissions from brands in restricted categories including tobacco, alcohol, cannabis/CBD, weapons, gambling, high-risk financial products, adult content, weight-loss supplements, pharmaceuticals, and political organizations — per TikTok&apos;s Branded Content Policy.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-white">Creator Responsibilities</h2>
          <p className="text-gray-400 leading-relaxed">Creators must produce original content. Reposting, clipping, or redistributing source footage owned by others is prohibited. All creators confirm they are at least 18 years old, own the connected TikTok account, and understand that all campaign posts are paid commercial content.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-white">Brand Responsibilities</h2>
          <p className="text-gray-400 leading-relaxed">Brands must be verified businesses, must not operate in restricted categories, and must only create campaigns for products that comply with TikTok&apos;s Branded Content Policy. All brands acknowledge these requirements during onboarding.</p>
        </section>
      </div>
      <PublicFooter />
    </div>
  );
}
