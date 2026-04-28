"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";

export default function PublicNav({ session }: { session: { role: string } | null }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const navLinks = [
    { href: "/for-creators", label: "For Creators" },
    { href: "/for-brands", label: "For Brands" },
    { href: "/campaigns", label: "Browse Campaigns" },
    { href: "/about", label: "About" },
  ];

  const getDashboardUrl = () => {
    if (!session) return "/login";
    if (session.role === "ADMIN") return "/admin";
    if (session.role === "BRAND_OWNER") return "/b/dashboard";
    return "/c/dashboard";
  };

  return (
    <nav className="fixed top-0 inset-x-0 z-50 border-b border-white/5 glass">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <img src="/logo.png" alt="Sleeckos" className="h-8 w-auto object-contain brightness-110" />
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-8">
            {navLinks.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`text-sm font-medium transition-colors ${
                  pathname === l.href
                    ? "text-purple-400"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                {l.label}
              </Link>
            ))}
          </div>

          {/* CTA */}
          <div className="hidden md:flex items-center gap-3">
            {session ? (
              <Link
                href={getDashboardUrl()}
                className="bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
              >
                Dashboard →
              </Link>
            ) : (
              <>
                <Link href="/login" className="text-sm text-gray-400 hover:text-white transition-colors">
                  Log in
                </Link>
                <Link
                  href="/signup"
                  className="bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
                >
                  Get started
                </Link>
              </>
            )}
          </div>

          {/* Mobile toggle */}
          <button className="md:hidden text-gray-400" onClick={() => setOpen(!open)}>
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden border-t border-white/5 bg-[#0a0a0f] px-4 py-4 space-y-4">
          {navLinks.map((l) => (
            <Link key={l.href} href={l.href} className="block text-gray-300 hover:text-white" onClick={() => setOpen(false)}>
              {l.label}
            </Link>
          ))}
          <div className="pt-2 border-t border-white/5 flex flex-col gap-2">
            <Link href="/login" className="text-gray-400 hover:text-white text-sm" onClick={() => setOpen(false)}>Log in</Link>
            <Link href="/signup" className="bg-purple-600 text-white text-sm font-semibold px-4 py-2 rounded-lg text-center" onClick={() => setOpen(false)}>
              Get started
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}
