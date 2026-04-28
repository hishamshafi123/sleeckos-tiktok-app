import Link from "next/link";

export default function PublicFooter() {
  return (
    <footer className="border-t border-white/5 mt-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
          <div className="col-span-2 md:col-span-1">
            <img src="/logo.png" alt="Sleeckos" className="h-8 w-auto object-contain brightness-110 mb-4" />
            <p className="text-gray-500 text-sm leading-relaxed">
              The compliant UGC marketplace for transparent, TikTok-native branded content.
            </p>
          </div>
          <div>
            <h4 className="text-white font-semibold text-sm mb-4">Platform</h4>
            <ul className="space-y-2">
              {[["For Creators", "/for-creators"], ["For Brands", "/for-brands"], ["Browse Campaigns", "/campaigns"], ["About", "/about"]].map(([l, h]) => (
                <li key={h}><Link href={h} className="text-gray-500 hover:text-white text-sm transition-colors">{l}</Link></li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-white font-semibold text-sm mb-4">Legal</h4>
            <ul className="space-y-2">
              {[["Privacy Policy", "/privacy"], ["Terms of Service", "/terms"], ["Branded Content Policy", "/branded-content-policy"], ["Contact", "/contact"]].map(([l, h]) => (
                <li key={h}><Link href={h} className="text-gray-500 hover:text-white text-sm transition-colors">{l}</Link></li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-white font-semibold text-sm mb-4">Compliance</h4>
            <p className="text-gray-500 text-xs leading-relaxed">
              All campaigns on Sleeckos are published with TikTok&apos;s Branded Content disclosure enabled. Disclosure is mandatory and cannot be disabled.
            </p>
          </div>
        </div>
        <div className="border-t border-white/5 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-gray-600 text-xs">© {new Date().getFullYear()} Sleeckos. All rights reserved.</p>
          <p className="text-gray-600 text-xs text-center">
            All campaign posts are published as &quot;Paid partnership&quot; in compliance with TikTok&apos;s Branded Content Policy and the FTC Endorsement Guides.
          </p>
        </div>
      </div>
    </footer>
  );
}
