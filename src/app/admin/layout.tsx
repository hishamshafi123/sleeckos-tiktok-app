import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import AdminSidebar from "@/components/AdminSidebar";
import { getEffectiveAccess } from "@/lib/services/permissions";
import AgentPanel from "@/components/AgentPanel";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const allowedTools = await getEffectiveAccess(session.userId);
  if (allowedTools.size === 0) {
    redirect("/login");
  }

  const allowedToolsArray = Array.from(allowedTools);

  // Agent panel is gated on the "agent" tool permission
  const showAgent = allowedTools.has("agent");

  return (
    <div className="min-h-screen flex bg-[#0a0a0f]">
      <AdminSidebar allowedTools={allowedToolsArray} />
      <main className="flex-1 ml-64 min-h-screen">
        <div className="max-w-6xl mx-auto px-8 py-8">
          {children}
        </div>
      </main>
      {showAgent && <AgentPanel />}
    </div>
  );
}

