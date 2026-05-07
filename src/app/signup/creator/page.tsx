"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, CheckCircle2, ArrowRight } from "lucide-react";

function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V9.41a8.16 8.16 0 0 0 4.77 1.52V7.49a4.85 4.85 0 0 1-1-.8z" />
    </svg>
  );
}

const NICHE_OPTIONS = [
  "Beauty", "Fashion", "Fitness", "Food", "Tech", "Travel",
  "Lifestyle", "Gaming", "Music", "Comedy", "Education", "Finance",
  "Pets", "Parenting",
];

type Mode = "choose" | "tiktok-tos" | "email";

export default function CreatorSignupPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("choose");
  const [loading, setLoading] = useState(false);

  // TikTok Kit flow — just needs TOS acceptance before redirect
  const [tiktokTos, setTiktokTos] = useState({
    ageConfirmed: false,
    disclosureAgreed: false,
  });

  // Email fallback form state
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    email: "", password: "", displayName: "", bio: "",
    nicheTags: [] as string[], ageConfirmed: false, disclosureAgreed: false,
  });

  const toggleNiche = (n: string) => {
    setForm((f) => ({
      ...f,
      nicheTags: f.nicheTags.includes(n)
        ? f.nicheTags.filter((t) => t !== n)
        : [...f.nicheTags, n],
    }));
  };

  const handleEmailSubmit = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup/creator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const text = await res.text();
      let data;
      try { data = text ? JSON.parse(text) : {}; } catch {
        throw new Error(`Server error (${res.status}): ${text.slice(0, 50)}`);
      }
      if (!res.ok) throw new Error(data.error || "Signup failed");
      toast.success("Account created! Let's connect your TikTok account.");
      router.push("/c/onboarding");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid-bg flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-lg">

        {/* Header */}
        <div className="text-center mb-8">
          <Link href="/">
            <img src="/logo.png" alt="Sleeckos" className="h-8 w-auto object-contain brightness-110 mx-auto mb-6" />
          </Link>
          <h1 className="text-2xl font-bold text-white">Apply as a Creator</h1>
          <p className="text-gray-500 text-sm mt-1">Join the Sleeckos creator marketplace</p>
        </div>

        {/* ══════════════════ MODE: choose ══════════════════ */}
        {mode === "choose" && (
          <div className="glass border border-white/8 rounded-2xl p-8 space-y-5">
            {/* TikTok Login Kit — primary */}
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-widest mb-3 font-medium">
                Recommended
              </p>
              <a
                id="tiktok-signup-btn"
                href="#"
                onClick={(e) => { e.preventDefault(); setMode("tiktok-tos"); }}
                className="group w-full flex items-center justify-center gap-3 bg-gradient-to-r from-[#010101] to-[#1a1a1a] hover:from-[#1a1a1a] hover:to-[#2a2a2a] border border-white/10 hover:border-white/25 text-white font-semibold py-4 rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl"
              >
                <TikTokIcon className="w-5 h-5 text-white group-hover:scale-110 transition-transform" />
                <span>Continue with TikTok</span>
                <ArrowRight className="w-4 h-4 opacity-40 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
              </a>
              <p className="text-xs text-gray-600 text-center mt-2">
                Your TikTok account is used to verify your creator status
              </p>
            </div>

            <div className="relative flex items-center gap-3">
              <div className="flex-1 h-px bg-white/8" />
              <span className="text-xs text-gray-600 flex-shrink-0">or</span>
              <div className="flex-1 h-px bg-white/8" />
            </div>

            {/* Email fallback */}
            <button
              id="email-signup-btn"
              onClick={() => setMode("email")}
              className="w-full bg-white/5 hover:bg-white/8 border border-white/10 text-gray-300 text-sm font-medium py-3 rounded-xl transition-all"
            >
              Sign up with Email &amp; Password
            </button>
          </div>
        )}

        {/* ══════════════════ MODE: tiktok-tos ══════════════════ */}
        {mode === "tiktok-tos" && (
          <div className="glass border border-white/8 rounded-2xl p-8 space-y-5">
            <div>
              <h2 className="font-semibold text-white text-lg mb-1">Before you continue</h2>
              <p className="text-gray-500 text-sm">
                All campaigns on Sleeckos require proper branded content disclosure. Please confirm:
              </p>
            </div>

            <div className="space-y-3">
              {[
                {
                  key: "ageConfirmed" as const,
                  text: "I am at least 18 years old",
                },
                {
                  key: "disclosureAgreed" as const,
                  text: "I understand that every campaign post I publish will be labeled as 'Paid partnership' with TikTok's Branded Content disclosure. I will not attempt to remove or hide this disclosure.",
                },
              ].map(({ key, text }) => (
                <label key={key} className="flex items-start gap-3 cursor-pointer group">
                  <div
                    onClick={() =>
                      setTiktokTos((t) => ({ ...t, [key]: !t[key] }))
                    }
                    className={`w-5 h-5 rounded flex-shrink-0 mt-0.5 border-2 flex items-center justify-center transition-all ${
                      tiktokTos[key]
                        ? "bg-purple-500 border-purple-500"
                        : "border-white/20 bg-white/5"
                    }`}
                  >
                    {tiktokTos[key] && (
                      <CheckCircle2 className="w-3 h-3 text-white" />
                    )}
                  </div>
                  <span className="text-sm text-gray-400">{text}</span>
                </label>
              ))}
            </div>

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setMode("choose")}
                className="flex-1 bg-white/5 hover:bg-white/10 text-white font-semibold py-3 rounded-xl transition-all border border-white/10"
              >
                ← Back
              </button>
              <a
                id="tiktok-tos-continue-btn"
                href={
                  tiktokTos.ageConfirmed && tiktokTos.disclosureAgreed
                    ? "/api/auth/tiktok?flow=signup"
                    : "#"
                }
                onClick={(e) => {
                  if (!tiktokTos.ageConfirmed || !tiktokTos.disclosureAgreed) {
                    e.preventDefault();
                  }
                }}
                className={`flex-1 flex items-center justify-center gap-2 font-semibold py-3 rounded-xl transition-all ${
                  tiktokTos.ageConfirmed && tiktokTos.disclosureAgreed
                    ? "bg-[#010101] hover:bg-[#1a1a1a] border border-white/10 text-white"
                    : "bg-white/5 text-gray-600 cursor-not-allowed border border-white/5"
                }`}
              >
                <TikTokIcon className="w-4 h-4" />
                Connect TikTok
              </a>
            </div>
          </div>
        )}

        {/* ══════════════════ MODE: email ══════════════════ */}
        {mode === "email" && (
          <>
            {/* Progress */}
            <div className="flex gap-2 mb-6">
              {[1, 2, 3].map((s) => (
                <div
                  key={s}
                  className={`flex-1 h-1 rounded-full transition-colors ${
                    s <= step ? "bg-purple-500" : "bg-white/10"
                  }`}
                />
              ))}
            </div>
            <p className="text-xs text-gray-500 text-center mb-4">Step {step} of 3</p>

            <div className="glass border border-white/8 rounded-2xl p-8">
              {step === 1 && (
                <div className="space-y-5">
                  <h2 className="font-semibold text-white text-lg">Your account</h2>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Email</label>
                    <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 text-sm transition-colors" placeholder="you@example.com" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Password</label>
                    <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 text-sm transition-colors" placeholder="8+ characters" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Display name</label>
                    <input type="text" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 text-sm transition-colors" placeholder="Your creator name" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Short bio</label>
                    <textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} rows={3} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 text-sm transition-colors resize-none" placeholder="What kind of content do you make?" />
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => setMode("choose")} className="flex-1 bg-white/5 hover:bg-white/10 text-white font-semibold py-3 rounded-xl transition-all border border-white/10">← Back</button>
                    <button onClick={() => setStep(2)} disabled={!form.email || !form.password || !form.displayName} className="flex-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-semibold py-3 rounded-xl transition-all">Continue →</button>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-5">
                  <h2 className="font-semibold text-white text-lg">Your niche</h2>
                  <p className="text-gray-500 text-sm">Select all that describe your content (pick at least one)</p>
                  <div className="flex flex-wrap gap-2">
                    {NICHE_OPTIONS.map((n) => (
                      <button key={n} onClick={() => toggleNiche(n)} className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all border ${form.nicheTags.includes(n) ? "bg-purple-500/20 border-purple-500 text-purple-300" : "bg-white/5 border-white/10 text-gray-400 hover:border-white/20"}`}>{n}</button>
                    ))}
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button onClick={() => setStep(1)} className="flex-1 bg-white/5 hover:bg-white/10 text-white font-semibold py-3 rounded-xl transition-all border border-white/10">← Back</button>
                    <button onClick={() => setStep(3)} disabled={form.nicheTags.length === 0} className="flex-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-semibold py-3 rounded-xl transition-all">Continue →</button>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-5">
                  <h2 className="font-semibold text-white text-lg">Disclosure agreement</h2>
                  <p className="text-gray-500 text-sm">All campaigns on Sleeckos require proper branded content disclosure. Please confirm:</p>
                  <div className="space-y-3">
                    {[
                      { key: "ageConfirmed", text: "I am at least 18 years old" },
                      { key: "disclosureAgreed", text: "I understand that every campaign post I publish will be labeled as 'Paid partnership' with TikTok's Branded Content disclosure. I will not attempt to remove or hide this disclosure." },
                    ].map(({ key, text }) => (
                      <label key={key} className="flex items-start gap-3 cursor-pointer group">
                        <div onClick={() => setForm((f) => ({ ...f, [key]: !f[key as keyof typeof f] }))} className={`w-5 h-5 rounded flex-shrink-0 mt-0.5 border-2 flex items-center justify-center transition-all ${form[key as keyof typeof form] ? "bg-purple-500 border-purple-500" : "border-white/20 bg-white/5"}`}>
                          {form[key as keyof typeof form] && <CheckCircle2 className="w-3 h-3 text-white" />}
                        </div>
                        <span className="text-sm text-gray-400">{text}</span>
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button onClick={() => setStep(2)} className="flex-1 bg-white/5 hover:bg-white/10 text-white font-semibold py-3 rounded-xl transition-all border border-white/10">← Back</button>
                    <button onClick={handleEmailSubmit} disabled={!form.ageConfirmed || !form.disclosureAgreed || loading} className="flex-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-semibold py-3 rounded-xl transition-all flex items-center justify-center gap-2">
                      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                      Create account →
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        <p className="text-center text-sm text-gray-600 mt-6">
          Already have an account?{" "}
          <Link href="/login" className="text-purple-400 hover:text-purple-300 transition-colors">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
