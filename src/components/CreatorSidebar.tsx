"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Search, ClipboardList, Zap, DollarSign, User, Settings, LogOut } from "lucide-react";
import { toast } from "sonner";

const NAV = [
  { href: "/c/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/c/campaigns", label: "Browse Campaigns", icon: Search },
  { href: "/c/applications", label: "My Applications", icon: ClipboardList },
  { href: "/c/active", label: "Active Work", icon: Zap },
  { href: "/c/earnings", label: "Earnings", icon: DollarSign },
  { href: "/c/profile", label: "My Profile", icon: User },
  { href: "/c/settings", label: "Settings", icon: Settings },
];

export default function CreatorSidebar() {
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
        <p className="text-xs text-gray-600 mt-2">Creator Portal</p>
      </div>
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link key={href} href={href} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${active ? "bg-purple-500/15 text-purple-300 border border-purple-500/20" : "text-gray-500 hover:text-white hover:bg-white/5"}`}>
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </Link>
          );
        })}
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
