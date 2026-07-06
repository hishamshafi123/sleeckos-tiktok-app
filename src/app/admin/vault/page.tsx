import React from "react";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { redirect } from "next/navigation";
import AccessDenied from "@/components/AccessDenied";
import prisma from "@/lib/db";
import VaultClientPage from "./VaultClientPage";

export const dynamic = "force-dynamic";

export default async function VaultPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const hasAccess = await can(session.userId, "projects");
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
