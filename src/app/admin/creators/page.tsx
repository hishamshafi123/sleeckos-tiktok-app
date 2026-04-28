export const dynamic = "force-dynamic";
import { prisma } from "@/lib/db";
import Link from "next/link";

export default async function AdminCreatorsPage() {
  const creators = await prisma.creatorProfile.findMany({ orderBy: { createdAt: "desc" }, include: { user: { select: { email: true, status: true } } } });
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Creators</h1>
      <div className="glass border border-white/5 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-white/5"><th className="text-left px-4 py-3 text-gray-500 font-medium">Name</th><th className="text-left px-4 py-3 text-gray-500 font-medium">Email</th><th className="text-left px-4 py-3 text-gray-500 font-medium">Niches</th><th className="text-left px-4 py-3 text-gray-500 font-medium">Status</th></tr></thead>
          <tbody>
            {creators.map((c)=>(
              <tr key={c.id} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-3 text-white font-medium">{c.displayName}</td>
                <td className="px-4 py-3 text-gray-500">{c.user.email}</td>
                <td className="px-4 py-3 text-gray-500">{c.nicheTags.slice(0,3).join(", ")}</td>
                <td className="px-4 py-3"><span className={`text-xs font-semibold px-2 py-1 rounded-full ${c.user.status === "APPROVED" ? "text-green-400 bg-green-400/10" : "text-yellow-400 bg-yellow-400/10"}`}>{c.user.status}</span></td>
              </tr>
            ))}
            {creators.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-600">No creators yet</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
