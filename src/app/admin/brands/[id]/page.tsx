export const dynamic = "force-dynamic";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, X, ShieldAlert } from "lucide-react";
import AdminBrandActions from "@/components/AdminBrandActions";

export default async function AdminBrandReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") redirect("/login");

  const { id } = await params;

  const brand = await prisma.brand.findUnique({
    where: { id },
    include: { ownerUser: { select: { email: true } } }
  });

  if (!brand) notFound();

  return (
    <div className="space-y-8 pb-20">
      <Link href="/admin/brands" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-white transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Back to brands
      </Link>

      <div>
        <h1 className="text-3xl font-black text-white mb-2">Review Brand: {brand.tradeName}</h1>
        <p className="text-gray-500">Review brand details before approving their account.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        <div className="glass border border-white/5 rounded-3xl p-8 space-y-6">
          <h3 className="text-white font-bold mb-4">Brand Information</h3>
          
          <div className="space-y-4">
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">Trade Name</p>
              <p className="text-white text-sm bg-white/5 px-4 py-2 rounded-xl">{brand.tradeName}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">Legal Name</p>
              <p className="text-white text-sm bg-white/5 px-4 py-2 rounded-xl">{brand.legalName}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">Owner Email</p>
              <p className="text-white text-sm bg-white/5 px-4 py-2 rounded-xl">{brand.ownerUser.email}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">Contact Email</p>
              <p className="text-white text-sm bg-white/5 px-4 py-2 rounded-xl">{brand.contactEmail}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">Website</p>
              <a href={brand.website} target="_blank" rel="noopener noreferrer" className="text-purple-400 text-sm bg-purple-500/10 px-4 py-2 rounded-xl inline-block hover:underline">{brand.website}</a>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">Category</p>
                <p className="text-white text-sm bg-white/5 px-4 py-2 rounded-xl">{brand.category}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">Status</p>
                <p className={`text-sm font-bold px-4 py-2 rounded-xl inline-block ${brand.status === 'APPROVED' ? 'bg-green-500/10 text-green-400' : brand.status === 'SUSPENDED' ? 'bg-red-500/10 text-red-400' : 'bg-yellow-500/10 text-yellow-400'}`}>{brand.status}</p>
              </div>
            </div>
            <div>
               <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">Compliance Check</p>
               <p className="text-sm flex items-center gap-2">
                 {brand.bannedCategoriesAcknowledged ? (
                   <span className="text-green-400 flex items-center gap-1"><Check className="w-4 h-4"/> Acknowledged banned categories</span>
                 ) : (
                   <span className="text-red-400 flex items-center gap-1"><X className="w-4 h-4"/> Did not acknowledge banned categories</span>
                 )}
               </p>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="glass border border-white/5 rounded-3xl p-8 space-y-6">
            <h3 className="text-white font-bold flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-500" />
              Actions
            </h3>
            
            {brand.status === 'PENDING' ? (
              <AdminBrandActions brandId={brand.id} />
            ) : (
              <div className="text-sm text-gray-400 text-center py-4">
                This brand has already been {brand.status.toLowerCase()}.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
