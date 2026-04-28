import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import BrandSidebar from "@/components/BrandSidebar";

export default async function BrandLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "BRAND_OWNER") redirect("/login");

  return (
    <div className="min-h-screen flex bg-[#0a0a0f]">
      <BrandSidebar />
      <main className="flex-1 ml-64 min-h-screen">
        <div className="max-w-5xl mx-auto px-8 py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
