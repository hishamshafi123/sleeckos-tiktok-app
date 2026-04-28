import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import AdminSidebar from "@/components/AdminSidebar";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN") redirect("/login");

  return (
    <div className="min-h-screen flex bg-[#0a0a0f]">
      <AdminSidebar />
      <main className="flex-1 ml-64 min-h-screen">
        <div className="max-w-6xl mx-auto px-8 py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
