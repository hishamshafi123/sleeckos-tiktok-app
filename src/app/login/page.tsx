"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

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

      // Redirect directly to admin panel on successful credentials
      router.push("/admin");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#09090b] flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo and Headings */}
        <div className="text-center">
          <Link href="/">
            <img
              src="/logo.png"
              alt="Sleeckos"
              className="h-7 w-auto object-contain brightness-110 mx-auto mb-4"
            />
          </Link>
          <h1 className="text-lg font-bold text-zinc-100 tracking-tight">Internal Ops Portal</h1>
          <p className="text-xs text-zinc-500 mt-1">
            Sign in to access admin tools and scheduling controls
          </p>
        </div>

        {/* Form Container */}
        <div className="border border-[#27272a] rounded-md bg-[#09090b] p-6 shadow-sm">
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-semibold tracking-wider text-zinc-500 block">
                Email Address
              </label>
              <input
                id="email-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-[#09090b] border border-[#27272a] rounded-md px-3 py-2 text-zinc-100 placeholder-zinc-700 focus:outline-none focus:border-[#2563eb] text-xs transition"
                placeholder="you@sleeckos.com"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-semibold tracking-wider text-zinc-500 block">
                Password
              </label>
              <input
                id="password-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full bg-[#09090b] border border-[#27272a] rounded-md px-3 py-2 text-zinc-100 placeholder-zinc-700 focus:outline-none focus:border-[#2563eb] text-xs transition"
                placeholder="••••••••"
              />
            </div>

            <button
              id="email-login-submit-btn"
              type="submit"
              disabled={loading}
              className="w-full bg-[#2563eb] hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold py-2 rounded-md transition flex items-center justify-center gap-2 mt-2"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Sign in
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
