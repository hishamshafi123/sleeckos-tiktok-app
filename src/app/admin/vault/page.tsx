import React from "react";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { redirect } from "next/navigation";
import AccessDenied from "@/components/AccessDenied";
import prisma from "@/lib/db";
import nextDynamic from "next/dynamic";

const VaultClientPage = nextDynamic(() => import("./VaultClientPage"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-screen bg-[#09090b] text-zinc-400">
      <div className="flex flex-col items-center gap-3">
        <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full" />
        <span>Loading Data Vault…</span>
      </div>
    </div>
  ),
});

export const dynamic = "force-dynamic";

export default async function VaultPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const hasAccess = await can(session.userId, "data_vault");
  if (!hasAccess) {
    return <AccessDenied tool="Data Vault" />;
  }

  const currentUser = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { role: true },
  });

  if (!currentUser) redirect("/login");

  return <VaultClientPage currentUserId={session.userId} userRole={currentUser.role.key} />;
}
