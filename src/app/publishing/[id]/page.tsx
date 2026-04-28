import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import CompliantComposer from "@/components/composer/CompliantComposer";

export default async function PublishingPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;

  const deliverable = await prisma.deliverable.findUnique({
    where: { id },
    include: { 
      campaign: { include: { brand: true } },
      creatorUser: { include: { tiktokAccount: true } }
    }
  });

  if (!deliverable || deliverable.creatorUserId !== session.userId) notFound();
  
  if (deliverable.status !== "DRAFT_APPROVED" && deliverable.status !== "READY_TO_PUBLISH" && deliverable.status !== "PUBLISHED") {
    redirect(`/c/active/${id}`);
  }

  const tiktokAccount = deliverable.creatorUser.tiktokAccount;
  if (!tiktokAccount) redirect("/c/onboarding");

  return (
    <div className="min-h-screen bg-[#050508] text-white">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="mb-10 text-center">
          <div className="inline-flex items-center gap-2 bg-purple-500/10 border border-purple-500/20 rounded-full px-4 py-1.5 text-purple-300 text-xs font-bold mb-6 uppercase tracking-widest">
            Compliant Composer
          </div>
          <h1 className="text-3xl font-black mb-2">Final Review & Publish</h1>
          <p className="text-gray-500">Your content has been approved by {deliverable.campaign.brand.tradeName}.</p>
        </div>

        <CompliantComposer 
          deliverable={deliverable} 
          tiktokAccount={tiktokAccount} 
        />
      </div>
    </div>
  );
}
