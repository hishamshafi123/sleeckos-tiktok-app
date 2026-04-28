"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, CheckCircle2 } from "lucide-react";

const NICHE_OPTIONS = ["Beauty", "Fashion", "Fitness", "Food", "Tech", "Travel", "Lifestyle", "Gaming", "Music", "Comedy", "Education", "Finance", "Pets", "Parenting"];

export default function CreatorSignupPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    email: "", password: "", displayName: "", bio: "",
    nicheTags: [] as string[], ageConfirmed: false, disclosureAgreed: false,
  });

  const toggleNiche = (n: string) => {
    setForm((f) => ({
      ...f,
      nicheTags: f.nicheTags.includes(n) ? f.nicheTags.filter((t) => t !== n) : [...f.nicheTags, n],
    }));
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup/creator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Signup failed");
      toast.success("Account created! Connecting your TikTok account...");
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
        <div className="text-center mb-8">
          <Link href="/"><img src="/logo.png" alt="Sleeckos" className="h-8 w-auto object-contain brightness-110 mx-auto mb-6" /></Link>
          <h1 className="text-2xl font-bold text-white">Apply as a Creator</h1>
          <p className="text-gray-500 text-sm mt-1">Step {step} of 3</p>
        </div>

        {/* Progress */}
        <div className="flex gap-2 mb-8">
          {[1,2,3].map((s) => (
            <div key={s} className={`flex-1 h-1 rounded-full transition-colors ${s <= step ? "bg-purple-500" : "bg-white/10"}`} />
          ))}
        </div>

        <div className="glass border border-white/8 rounded-2xl p-8">
          {step === 1 && (
            <div className="space-y-5">
              <h2 className="font-semibold text-white text-lg">Your account</h2>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Email</label>
                <input type="email" value={form.email} onChange={(e) => setForm({...form, email: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 text-sm transition-colors" placeholder="you@example.com" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Password</label>
                <input type="password" value={form.password} onChange={(e) => setForm({...form, password: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 text-sm transition-colors" placeholder="8+ characters" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Display name</label>
                <input type="text" value={form.displayName} onChange={(e) => setForm({...form, displayName: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 text-sm transition-colors" placeholder="Your creator name" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Short bio</label>
                <textarea value={form.bio} onChange={(e) => setForm({...form, bio: e.target.value})} rows={3} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 text-sm transition-colors resize-none" placeholder="What kind of content do you make?" />
              </div>
              <button onClick={() => setStep(2)} disabled={!form.email || !form.password || !form.displayName} className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-semibold py-3 rounded-xl transition-all">
                Continue →
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <h2 className="font-semibold text-white text-lg">Your niche</h2>
              <p className="text-gray-500 text-sm">Select all that describe your content (pick at least one)</p>
              <div className="flex flex-wrap gap-2">
                {NICHE_OPTIONS.map((n) => (
                  <button key={n} onClick={() => toggleNiche(n)} className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all border ${form.nicheTags.includes(n) ? "bg-purple-500/20 border-purple-500 text-purple-300" : "bg-white/5 border-white/10 text-gray-400 hover:border-white/20"}`}>
                    {n}
                  </button>
                ))}
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setStep(1)} className="flex-1 bg-white/5 hover:bg-white/10 text-white font-semibold py-3 rounded-xl transition-all border border-white/10">
                  ← Back
                </button>
                <button onClick={() => setStep(3)} disabled={form.nicheTags.length === 0} className="flex-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-semibold py-3 rounded-xl transition-all">
                  Continue →
                </button>
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
                    <div
                      onClick={() => setForm((f) => ({ ...f, [key]: !f[key as keyof typeof f] }))}
                      className={`w-5 h-5 rounded flex-shrink-0 mt-0.5 border-2 flex items-center justify-center transition-all ${form[key as keyof typeof form] ? "bg-purple-500 border-purple-500" : "border-white/20 bg-white/5"}`}
                    >
                      {form[key as keyof typeof form] && <CheckCircle2 className="w-3 h-3 text-white" />}
                    </div>
                    <span className="text-sm text-gray-400">{text}</span>
                  </label>
                ))}
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => setStep(2)} className="flex-1 bg-white/5 hover:bg-white/10 text-white font-semibold py-3 rounded-xl transition-all border border-white/10">
                  ← Back
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={!form.ageConfirmed || !form.disclosureAgreed || loading}
                  className="flex-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-semibold py-3 rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  Create account →
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-sm text-gray-600 mt-6">
          Already have an account? <Link href="/login" className="text-purple-400 hover:text-purple-300 transition-colors">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
