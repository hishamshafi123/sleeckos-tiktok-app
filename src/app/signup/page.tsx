import Link from "next/link";
import { TrendingUp, Shield } from "lucide-react";

export default function SignupPickerPage() {
  return (
    <div className="min-h-screen grid-bg flex items-center justify-center px-4">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-10">
          <Link href="/">
            <img src="/logo.png" alt="Sleeckos" className="h-10 w-auto object-contain brightness-110 mx-auto mb-6" />
          </Link>
          <h1 className="text-3xl font-bold text-white">Join Sleeckos</h1>
          <p className="text-gray-500 mt-2">Choose how you want to use the platform</p>
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          <Link href="/signup/creator" className="glass border border-white/8 hover:border-purple-500/40 rounded-2xl p-8 transition-all group hover:shadow-lg hover:shadow-purple-500/10 block">
            <div className="w-14 h-14 bg-purple-500/20 rounded-2xl flex items-center justify-center mb-5 group-hover:bg-purple-500/30 transition-colors">
              <TrendingUp className="w-7 h-7 text-purple-400" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">I&apos;m a Creator</h2>
            <p className="text-gray-500 text-sm leading-relaxed mb-4">
              I make original TikTok content and want to work with brands on paid campaigns.
            </p>
            <ul className="text-sm text-gray-500 space-y-1">
              <li className="flex items-center gap-2"><span className="text-green-400">✓</span> Browse paid campaigns</li>
              <li className="flex items-center gap-2"><span className="text-green-400">✓</span> Flat fee per approved post</li>
              <li className="flex items-center gap-2"><span className="text-green-400">✓</span> Full creative control</li>
            </ul>
            <div className="mt-6 text-purple-400 font-semibold text-sm group-hover:text-purple-300 transition-colors">
              Apply as a creator →
            </div>
          </Link>

          <Link href="/signup/brand" className="glass border border-white/8 hover:border-purple-500/40 rounded-2xl p-8 transition-all group hover:shadow-lg hover:shadow-purple-500/10 block">
            <div className="w-14 h-14 bg-purple-500/20 rounded-2xl flex items-center justify-center mb-5 group-hover:bg-purple-500/30 transition-colors">
              <Shield className="w-7 h-7 text-purple-400" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">I&apos;m a Brand</h2>
            <p className="text-gray-500 text-sm leading-relaxed mb-4">
              I represent a verified business and want to commission original UGC from creators.
            </p>
            <ul className="text-sm text-gray-500 space-y-1">
              <li className="flex items-center gap-2"><span className="text-green-400">✓</span> Post campaign briefs</li>
              <li className="flex items-center gap-2"><span className="text-green-400">✓</span> Review creator applications</li>
              <li className="flex items-center gap-2"><span className="text-green-400">✓</span> Full compliance built in</li>
            </ul>
            <div className="mt-6 text-purple-400 font-semibold text-sm group-hover:text-purple-300 transition-colors">
              Register your brand →
            </div>
          </Link>
        </div>

        <p className="text-center text-sm text-gray-600 mt-8">
          Already have an account?{" "}
          <Link href="/login" className="text-purple-400 hover:text-purple-300 transition-colors">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
