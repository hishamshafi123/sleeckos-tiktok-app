"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Shield, Users, Megaphone, FileText, AlertTriangle, ScrollText, LogOut } from "lucide-react";
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
      <nav className="flex-1 p-4 space-y-1">
        {NAV.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link key={href} href={href} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${active ? "bg-amber-500/15 text-amber-300 border border-amber-500/20" : "text-gray-500 hover:text-white hover:bg-white/5"}`}>
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
