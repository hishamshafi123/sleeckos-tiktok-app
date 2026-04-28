export const dynamic = "force-dynamic";
import PublicNav from "@/components/PublicNav";
import PublicFooter from "@/components/PublicFooter";
import { getSession } from "@/lib/session";

export default async function ContactPage() {
  const session = await getSession();
  return (
    <div className="min-h-screen">
      <PublicNav session={session} />
      <div className="pt-32 pb-20 px-4 max-w-xl mx-auto">
        <h1 className="text-4xl font-bold text-white mb-6">Contact</h1>
        <div className="glass border border-white/5 rounded-2xl p-8 space-y-5">
          {[
            ["General enquiries", "hello@sleeckos.com"],
            ["Brand partnerships", "brands@sleeckos.com"],
            ["Creator support", "creators@sleeckos.com"],
            ["Compliance & legal", "legal@sleeckos.com"],
          ].map(([label, email]) => (
            <div key={label}>
              <p className="text-xs text-gray-500 mb-1">{label}</p>
              <a href={`mailto:${email}`} className="text-purple-400 hover:text-purple-300 transition-colors">{email}</a>
            </div>
          ))}
        </div>
      </div>
      <PublicFooter />
    </div>
  );
}
