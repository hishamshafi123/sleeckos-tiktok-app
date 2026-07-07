"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  LogOut,
  MonitorPlay,
  BarChart3,
  Clock,
  History,
  Sparkles,
  Layers,
  Film,
  UserCog,
  Palette,
  Music,
  FolderOpen,
  Key,
  GraduationCap,
  Database
} from "lucide-react";
import { toast } from "sonner";

const PRODUCTION_NAV = [
  { href: "/admin/clip-mixer", label: "Clip Mixer", icon: Film, toolKey: "clip_mixer" },
  { href: "/admin/style-studio", label: "Style Studio", icon: Palette, toolKey: "style_studio" },
  { href: "/admin/genres", label: "Bulk Genres", icon: Music, toolKey: "composer" },
  { href: "/admin/multiplier", label: "Multiplier", icon: Layers, toolKey: "multiplier" },
];

const OPERATIONS_NAV = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true, toolKey: "overview" },
  { href: "/admin/accounts", label: "Managed Accounts", icon: MonitorPlay, exact: true, toolKey: "accounts" },
  { href: "/admin/accounts/dashboard", label: "Analytics", icon: BarChart3, toolKey: "analytics" },
  { href: "/admin/accounts/queue", label: "Post Queue", icon: Clock, toolKey: "post_queue" },
  { href: "/admin/accounts/history", label: "History", icon: History, toolKey: "history" },
  { href: "/admin/campaigns", label: "Campaigns", icon: FolderOpen, toolKey: "campaigns" },
  { href: "/admin/projects", label: "Projects", icon: FolderOpen, toolKey: "projects" },
  { href: "/admin/vault", label: "Data Vault", icon: Database, toolKey: "data_vault" },
  { href: "/admin/sourcing", label: "Sourcing Feed", icon: Sparkles, toolKey: "sourcing" },
];

const PEOPLE_NAV = [
  { href: "/admin/users-access", label: "Users & Access", icon: Key, toolKey: "users_access" },
  { href: "/admin/lms", label: "LMS", icon: GraduationCap, toolKey: "lms" },
  { href: "/admin/team", label: "Team", icon: UserCog, toolKey: "users_access" },
];

interface AdminSidebarProps {
  allowedTools?: string[];
}

export default function AdminSidebar({ allowedTools = [] }: AdminSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    toast.success("Logged out");
    router.push("/login");
  };

  const allowedSet = new Set(allowedTools);

  const filteredProduction = PRODUCTION_NAV.filter(item => allowedSet.has(item.toolKey));
  const filteredOperations = OPERATIONS_NAV.filter(item => allowedSet.has(item.toolKey));
  const filteredPeople = PEOPLE_NAV.filter(item => allowedSet.has(item.toolKey));

  const renderLink = (item: { href: string; label: string; icon: any; exact?: boolean }) => {
    const Icon = item.icon;
    const active = item.exact
      ? pathname === item.href
      : pathname.startsWith(item.href) && !(item.href === "/admin" && pathname !== "/admin");

    return (
      <Link
        key={item.href}
        href={item.href}
        className={`flex items-center gap-3 px-3 py-2 rounded-md text-xs font-medium border transition-all ${
          active
            ? "bg-[#2563eb]/10 text-[#2563eb] border-[#2563eb]/20"
            : "text-zinc-400 border-transparent hover:text-zinc-200 hover:bg-zinc-900"
        }`}
      >
        <Icon className="w-3.5 h-3.5 flex-shrink-0" />
        {item.label}
      </Link>
    );
  };

  return (
    <aside className="fixed left-0 top-0 h-screen w-60 border-r border-[#27272a] bg-[#09090b] flex flex-col z-30">
      <div className="p-4 border-b border-[#27272a]">
        <Link href="/admin" className="flex items-center gap-2">
          <img
            src="/logo.png"
            alt="Sleeckos"
            className="h-6 w-auto object-contain brightness-110"
          />
        </Link>
        <p className="text-[10px] text-zinc-500 mt-1 font-semibold uppercase tracking-wider">
          Internal Ops
        </p>
      </div>

      <nav className="flex-1 p-3 space-y-4 overflow-y-auto">
        {/* Production Group */}
        {filteredProduction.length > 0 && (
          <div>
            <p className="px-3 mb-1.5 text-[9px] uppercase tracking-wider text-zinc-600 font-bold">
              Production
            </p>
            <div className="space-y-0.5">{filteredProduction.map(renderLink)}</div>
          </div>
        )}

        {/* Operations Group */}
        {filteredOperations.length > 0 && (
          <div>
            <p className="px-3 mb-1.5 text-[9px] uppercase tracking-wider text-zinc-600 font-bold">
              Operations
            </p>
            <div className="space-y-0.5">{filteredOperations.map(renderLink)}</div>
          </div>
        )}

        {/* People Group */}
        {filteredPeople.length > 0 && (
          <div>
            <p className="px-3 mb-1.5 text-[9px] uppercase tracking-wider text-zinc-600 font-bold">
              People
            </p>
            <div className="space-y-0.5">{filteredPeople.map(renderLink)}</div>
          </div>
        )}
      </nav>

      <div className="p-3 border-t border-[#27272a]">
        <button
          onClick={logout}
          className="flex items-center gap-3 px-3 py-2 rounded-md text-xs text-zinc-400 hover:text-red-400 hover:bg-red-950/20 transition-all w-full text-left"
        >
          <LogOut className="w-3.5 h-3.5" />
          Log out
        </button>
      </div>
    </aside>
  );
}
