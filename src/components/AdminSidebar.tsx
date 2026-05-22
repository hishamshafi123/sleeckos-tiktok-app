"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Shield, Users, Megaphone, FileText, AlertTriangle, ScrollText, LogOut, MonitorPlay, BarChart3, Clock, History, Sparkles } from "lucide-react";
import { toast } from "sonner";

const NAV = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/brands", label: "Brands", icon: Shield },
  { href: "/admin/creators", label: "Creators", icon: Users },
  { href: "/admin/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/admin/applications", label: "Applications", icon: FileText },
  { href: "/admin/disputes", label: "Disputes", icon: AlertTriangle },
  { href: "/admin/audit-log", label: "Audit Log", icon: ScrollText },
];

const ACCOUNTS_NAV = [
  { href: "/admin/accounts", label: "Manage", icon: MonitorPlay, exact: true },
  { href: "/admin/accounts/dashboard", label: "Analytics", icon: BarChart3 },
  { href: "/admin/accounts/queue", label: "Post Queue", icon: Clock },
  { href: "/admin/accounts/history", label: "History", icon: History },
  { href: "/admin/genres", label: "Bulk Genres", icon: Sparkles },
];

export default function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    toast.success("Logged out");
    router.push("/login");
  };
  return (
    <aside className="fixed left-0 top-0 h-screen w-64 border-r border-white/5 bg-[#0d0d14] flex flex-col">
      <div className="p-5 border-b border-white/5">
        <Link href="/"><img src="/logo.png" alt="Sleeckos" className="h-7 w-auto object-contain brightness-110" /></Link>
        <p className="text-xs text-amber-500 mt-2 font-semibold">Admin Panel</p>
      </div>
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {NAV.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link key={href} href={href} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${active ? "bg-amber-500/15 text-amber-300 border border-amber-500/20" : "text-gray-500 hover:text-white hover:bg-white/5"}`}>
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </Link>
          );
        })}

        {/* TikTok Accounts section */}
        <div className="pt-4 mt-4 border-t border-white/5">
          <p className="px-3 mb-2 text-[10px] uppercase tracking-widest text-gray-600 font-bold">TikTok Accounts</p>
          {ACCOUNTS_NAV.map(({ href, label, icon: Icon, exact }) => {
            const active = exact
              ? pathname === href
              : pathname.startsWith(href) && !ACCOUNTS_NAV.some(n => n.href !== href && n.href.length > href.length && pathname.startsWith(n.href));
            return (
              <Link key={href} href={href} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${active ? "bg-purple-500/15 text-purple-300 border border-purple-500/20" : "text-gray-500 hover:text-white hover:bg-white/5"}`}>
                <Icon className="w-4 h-4 flex-shrink-0" />
                {label}
              </Link>
            );
          })}
        </div>

        {/* Video Sourcing section */}
        <div className="pt-4 mt-4 border-t border-white/5">
          <p className="px-3 mb-2 text-[10px] uppercase tracking-widest text-gray-600 font-bold">Video Sourcing</p>
          <Link
            href="/admin/sourcing"
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
              pathname.startsWith("/admin/sourcing")
                ? "bg-red-500/15 text-red-300 border border-red-500/20"
                : "text-gray-500 hover:text-white hover:bg-white/5"
            }`}
          >
            <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
            Sourcing Feed
          </Link>
        </div>
      </nav>
      <div className="p-4 border-t border-white/5">
        <button onClick={logout} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-600 hover:text-red-400 hover:bg-red-400/5 transition-all w-full">
          <LogOut className="w-4 h-4" />
          Log out
        </button>
      </div>
    </aside>
  );
}
