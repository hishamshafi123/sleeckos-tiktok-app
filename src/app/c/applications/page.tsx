export const dynamic = "force-dynamic";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export default async function CreatorApplicationsPage() {
  const session = await getSession();
  if (!session) return null;
  const apps = await prisma.application.findMany({
    where: { creatorUserId: session.userId },
    include: { campaign: { include: { brand: true } } },
    orderBy: { createdAt: "desc" },
  });
  const STATUS_COLORS: Record<string,string> = {
    SUBMITTED:"text-yellow-400 bg-yellow-400/10", UNDER_REVIEW:"text-blue-400 bg-blue-400/10",
    ACCEPTED:"text-green-400 bg-green-400/10", REJECTED:"text-red-400 bg-red-400/10", WITHDRAWN:"text-gray-400 bg-gray-400/10",
  };
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">My Applications</h1>
      {apps.length === 0 ? (
        <div className="glass border border-white/5 rounded-2xl p-12 text-center text-gray-500">No applications yet.</div>
      ) : (
        <div className="space-y-3">
          {apps.map((a)=>(
            <div key={a.id} className="glass border border-white/5 rounded-xl p-5 flex items-center justify-between">
              <div>
                <p className="font-medium text-white">{a.campaign.title}</p>
                <p className="text-xs text-gray-500">{a.campaign.brand.tradeName} · Applied {new Date(a.createdAt).toLocaleDateString()}</p>
              </div>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_COLORS[a.status]}`}>{a.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
