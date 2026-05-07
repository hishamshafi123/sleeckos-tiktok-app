import Link from "next/link";

function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V9.41a8.16 8.16 0 0 0 4.77 1.52V7.49a4.85 4.85 0 0 1-1-.8z" />
    </svg>
  );
}

export default function ConnectTikTokPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Connect TikTok</h1>
        <p className="text-gray-400 mt-1">
          Link your TikTok account to verify your creator status and start applying to campaigns.
        </p>
      </div>

      <div className="glass border border-white/8 rounded-2xl p-6 space-y-4 max-w-md">
        <div className="space-y-2">
          <p className="text-sm text-gray-300 font-medium">What you&apos;ll grant access to:</p>
          <ul className="text-sm text-gray-500 space-y-1.5">
            <li className="flex items-center gap-2"><span className="text-green-400">✓</span> Basic profile info (username, avatar)</li>
            <li className="flex items-center gap-2"><span className="text-green-400">✓</span> Follower &amp; engagement stats</li>
            <li className="flex items-center gap-2"><span className="text-green-400">✓</span> Ability to publish campaign videos</li>
          </ul>
        </div>

        {/* flow=connect so callback keeps the current session */}
        <Link
          href="/api/auth/tiktok?flow=connect"
          className="group w-full flex items-center justify-center gap-3 bg-[#010101] hover:bg-[#1a1a1a] border border-white/10 hover:border-white/20 text-white font-semibold px-6 py-3.5 rounded-xl transition-all"
        >
          <TikTokIcon className="w-5 h-5 group-hover:scale-110 transition-transform" />
          Connect with TikTok
        </Link>
      </div>
    </div>
  );
}
