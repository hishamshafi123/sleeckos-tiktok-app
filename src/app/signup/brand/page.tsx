"use client";
import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, AlertTriangle } from "lucide-react";

const ALLOWED_CATEGORIES = ["BEAUTY", "FASHION", "FITNESS", "FOOD", "TECH", "TRAVEL", "LIFESTYLE", "OTHER"];
const BANNED_CATEGORIES = ["Tobacco/Vaping", "Alcohol", "Cannabis/CBD", "Weapons/Firearms", "Gambling", "Crypto/Forex", "Adult Content", "Weight-loss supplements", "Pharmaceuticals", "Political organizations"];

export default function BrandSignupPage() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [bannedSelected, setBannedSelected] = useState(false);
  const [form, setForm] = useState({
    email: "", password: "", legalName: "", tradeName: "",
    website: "", category: "", contactEmail: "", tiktokHandle: "",
    registrationNumber: "", policyAcknowledged: false, bannedAcknowledged: false,
  });

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup/brand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Signup failed");
      setStep(4);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  if (step === 4) {
    return (
      <div className="min-h-screen grid-bg flex items-center justify-center px-4">
        <div className="w-full max-w-md text-center">
          <div className="w-20 h-20 bg-purple-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <span className="text-3xl">🎉</span>
          </div>
          <h1 className="text-2xl font-bold text-white mb-3">Application submitted!</h1>
          <p className="text-gray-500 leading-relaxed mb-6">
            We&apos;ve received your brand registration. Our team will review your application within 2-3 business days. We&apos;ll email you at <strong className="text-white">{form.contactEmail}</strong> with the outcome.
          </p>
          <Link href="/login" className="text-purple-400 hover:text-purple-300 transition-colors text-sm">Sign in when approved →</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen grid-bg flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <Link href="/"><img src="/logo.png" alt="Sleeckos" className="h-8 w-auto object-contain brightness-110 mx-auto mb-6" /></Link>
          <h1 className="text-2xl font-bold text-white">Register your Brand</h1>
          <p className="text-gray-500 text-sm mt-1">Step {step} of 3 · Manual approval required</p>
        </div>

        <div className="flex gap-2 mb-8">
          {[1,2,3].map((s) => <div key={s} className={`flex-1 h-1 rounded-full transition-colors ${s <= step ? "bg-purple-500" : "bg-white/10"}`} />)}
        </div>

        <div className="glass border border-white/8 rounded-2xl p-8">
          {step === 1 && (
            <div className="space-y-5">
              <h2 className="font-semibold text-white text-lg">Account & company info</h2>
              {[
                { label: "Login email", key: "email", type: "email", placeholder: "you@company.com" },
                { label: "Password", key: "password", type: "password", placeholder: "8+ characters" },
                { label: "Legal company name", key: "legalName", type: "text", placeholder: "Acme Corp Ltd" },
                { label: "Trade name / brand name", key: "tradeName", type: "text", placeholder: "Acme" },
                { label: "Company website", key: "website", type: "url", placeholder: "https://acme.com" },
                { label: "Contact email", key: "contactEmail", type: "email", placeholder: "partnerships@acme.com" },
              ].map(({ label, key, type, placeholder }) => (
                <div key={key}>
                  <label className="block text-sm font-medium text-gray-300 mb-2">{label}</label>
                  <input type={type} value={String(form[key as keyof typeof form])} onChange={(e) => setForm({...form, [key]: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 text-sm transition-colors" placeholder={placeholder} />
                </div>
              ))}
              <button onClick={() => setStep(2)} disabled={!form.email || !form.password || !form.legalName || !form.website} className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-semibold py-3 rounded-xl transition-all">
                Continue →
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <h2 className="font-semibold text-white text-lg">Brand category</h2>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">What category best describes your brand?</label>
                <select value={form.category} onChange={(e) => setForm({...form, category: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500 text-sm transition-colors">
                  <option value="">Select a category</option>
                  {ALLOWED_CATEGORIES.map((c) => <option key={c} value={c}>{c.charAt(0) + c.slice(1).toLowerCase()}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">TikTok handle (optional but recommended)</label>
                <input type="text" value={form.tiktokHandle} onChange={(e) => setForm({...form, tiktokHandle: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 text-sm transition-colors" placeholder="@yourbrand" />
                <p className="text-gray-600 text-xs mt-1">Required to be tagged in creator Branded Content posts</p>
              </div>

              {/* Banned categories warning */}
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                <div className="flex items-start gap-2 mb-3">
                  <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-amber-300 font-medium">Restricted categories</p>
                </div>
                <p className="text-xs text-amber-400/80 mb-3">Branded content campaigns for the following are not supported per TikTok&apos;s Branded Content Policy:</p>
                <div className="flex flex-wrap gap-1">
                  {BANNED_CATEGORIES.map((c) => <span key={c} className="text-xs bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded-full">{c}</span>)}
                </div>
              </div>

              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={form.bannedAcknowledged} onChange={(e) => setForm({...form, bannedAcknowledged: e.target.checked})} className="mt-1 w-4 h-4 accent-purple-500" />
                <span className="text-sm text-gray-400">I confirm that my brand is not in any of the restricted categories listed above.</span>
              </label>

              <div className="flex gap-3">
                <button onClick={() => setStep(1)} className="flex-1 bg-white/5 hover:bg-white/10 text-white font-semibold py-3 rounded-xl transition-all border border-white/10">← Back</button>
                <button onClick={() => setStep(3)} disabled={!form.category || !form.bannedAcknowledged} className="flex-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-semibold py-3 rounded-xl transition-all">Continue →</button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <h2 className="font-semibold text-white text-lg">Policy acknowledgement</h2>
              <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-4 text-sm text-purple-300 leading-relaxed">
                All deliverables on Sleeckos are published with TikTok&apos;s Branded Content disclosure enabled and labeled as &ldquo;Paid partnership&rdquo;. This is automatic and cannot be disabled. Make sure your campaign brief is appropriate for transparent paid content under TikTok&apos;s Branded Content Policy.
              </div>
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={form.policyAcknowledged} onChange={(e) => setForm({...form, policyAcknowledged: e.target.checked})} className="mt-1 w-4 h-4 accent-purple-500" />
                <span className="text-sm text-gray-400">I have read TikTok&apos;s Branded Content Policy and will only run campaigns for products that comply with it.</span>
              </label>
              <div className="flex gap-3">
                <button onClick={() => setStep(2)} className="flex-1 bg-white/5 hover:bg-white/10 text-white font-semibold py-3 rounded-xl transition-all border border-white/10">← Back</button>
                <button onClick={handleSubmit} disabled={!form.policyAcknowledged || loading} className="flex-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-semibold py-3 rounded-xl transition-all flex items-center justify-center gap-2">
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  Submit for review →
                </button>
              </div>
            </div>
          )}
        </div>
        <p className="text-center text-sm text-gray-600 mt-6">
          Already approved? <Link href="/login" className="text-purple-400 hover:text-purple-300 transition-colors">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
