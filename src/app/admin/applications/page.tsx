export const dynamic = "force-dynamic";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import AdminApplicationCard from "@/components/AdminApplicationCard";

export default async function AdminApplicationsPage() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") redirect("/login");

  const applications = await prisma.application.findMany({
    include: {
      campaign: { include: { brand: true } },
      creatorUser: { include: { creatorProfile: true } },
      deliverable: true
    },
    orderBy: { createdAt: "desc" }
  });

  return (
    <div className="space-y-8 pb-20">
      <div>
        <h1 className="text-3xl font-black text-white mb-2">Manage Applications</h1>
        <p className="text-gray-500">Review pitches and approve creators for campaigns.</p>
      </div>

      {applications.length === 0 ? (
        <div className="glass border border-white/5 rounded-3xl p-12 text-center text-gray-500">
          No applications to review yet.
        </div>
      ) : (
        <div className="grid gap-6">
          {applications.map((app) => (
            <AdminApplicationCard key={app.id} application={app} />
          ))}
        </div>
      )}
    </div>
  );
}
