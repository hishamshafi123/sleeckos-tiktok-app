"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V9.41a8.16 8.16 0 0 0 4.77 1.52V7.49a4.85 4.85 0 0 1-1-.8z" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");

      if (data.role === "ADMIN") router.push("/admin");
      else if (data.role === "BRAND_OWNER") router.push("/b/dashboard");
      else router.push("/c/dashboard");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid-bg flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/">
            <img
              src="/logo.png"
              alt="Sleeckos"
              className="h-10 w-auto object-contain brightness-110 mx-auto mb-6"
            />
          </Link>
          <h1 className="text-2xl font-bold text-white">Welcome back</h1>
          <p className="text-gray-500 mt-2 text-sm">
            Sign in to your Sleeckos account
          </p>
        </div>

        <div className="glass border border-white/8 rounded-2xl p-8 space-y-4">
          {/* ── TikTok Login Kit (primary CTA for creators) ── */}
          <a
            id="tiktok-login-btn"
            href="/api/auth/tiktok?flow=login"
            className="group w-full flex items-center justify-center gap-3 bg-gradient-to-r from-[#010101] to-[#1a1a1a] hover:from-[#1a1a1a] hover:to-[#2a2a2a] border border-white/10 hover:border-white/20 text-white font-semibold py-3.5 rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl"
          >
            <TikTokIcon className="w-5 h-5 text-white group-hover:scale-110 transition-transform" />
            <span>Continue with TikTok</span>
          </a>

          {/* ── Divider ── */}
          <div className="relative flex items-center gap-3 py-1">
            <div className="flex-1 h-px bg-white/8" />
            <span className="text-xs text-gray-600 flex-shrink-0">
              or sign in with email
            </span>
            <div className="flex-1 h-px bg-white/8" />
          </div>

          {/* ── Email / password form (brands + admin) ── */}
          {!showEmailForm ? (
            <button
              id="show-email-login-btn"
              onClick={() => setShowEmailForm(true)}
              className="w-full bg-white/5 hover:bg-white/8 border border-white/10 text-gray-300 text-sm font-medium py-3 rounded-xl transition-all"
            >
              Sign in with Email &amp; Password
            </button>
          ) : (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Email
                </label>
                <input
                  id="email-input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 transition-colors text-sm"
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Password
                </label>
                <input
                  id="password-input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 transition-colors text-sm"
                  placeholder="••••••••"
                />
              </div>
              <button
                id="email-login-submit-btn"
                type="submit"
                disabled={loading}
                className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-all flex items-center justify-center gap-2"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                Sign in
              </button>
            </form>
          )}
        </div>

        {/* Footer links */}
        <div className="mt-6 text-center text-sm text-gray-500 space-y-2">
          <p>
            New creator?{" "}
            <a
              href="/api/auth/tiktok?flow=signup"
              className="text-purple-400 hover:text-purple-300 font-medium transition-colors"
            >
              Join with TikTok →
            </a>
          </p>
          <p>
            Brand or business?{" "}
            <Link
              href="/signup/brand"
              className="text-purple-400 hover:text-purple-300 font-medium transition-colors"
            >
              Register your brand
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
