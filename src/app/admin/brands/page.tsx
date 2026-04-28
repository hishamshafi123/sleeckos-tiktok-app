export const dynamic = "force-dynamic";
import { prisma } from "@/lib/db";
import Link from "next/link";

export default async function AdminBrandsPage() {
  const brands = await prisma.brand.findMany({ orderBy: { createdAt: "desc" }, include: { ownerUser: { select: { email: true } } } });
  const STATUS_COLORS: Record<string,string> = { PENDING:"text-yellow-400 bg-yellow-400/10", APPROVED:"text-green-400 bg-green-400/10", SUSPENDED:"text-red-400 bg-red-400/10" };
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Brands</h1>
      <div className="glass border border-white/5 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-white/5"><th className="text-left px-4 py-3 text-gray-500 font-medium">Brand</th><th className="text-left px-4 py-3 text-gray-500 font-medium">Category</th><th className="text-left px-4 py-3 text-gray-500 font-medium">Email</th><th className="text-left px-4 py-3 text-gray-500 font-medium">Status</th><th className="px-4 py-3"></th></tr></thead>
          <tbody>
            {brands.map((b)=>(
              <tr key={b.id} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-3 text-white font-medium">{b.tradeName}</td>
                <td className="px-4 py-3 text-gray-500">{b.category}</td>
                <td className="px-4 py-3 text-gray-500">{b.ownerUser.email}</td>
                <td className="px-4 py-3"><span className={`text-xs font-semibold px-2 py-1 rounded-full ${STATUS_COLORS[b.status]}`}>{b.status}</span></td>
                <td className="px-4 py-3"><Link href={`/admin/brands/${b.id}`} className="text-xs text-purple-400 hover:text-purple-300">Review →</Link></td>
              </tr>
            ))}
            {brands.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-600">No brands yet</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
