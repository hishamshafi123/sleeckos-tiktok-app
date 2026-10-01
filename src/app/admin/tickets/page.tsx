import React from "react";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { redirect } from "next/navigation";
import AccessDenied from "@/components/AccessDenied";
import prisma from "@/lib/db";
import TicketsClient from "./TicketsClient";

export const dynamic = "force-dynamic";

export default async function TicketsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const hasAccess = await can(session.userId, "tickets");
  if (!hasAccess) {
    return <AccessDenied tool="Tickets" />;
  }

  // Fetch current user and role
  const currentUser = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { role: true },
  });

  if (!currentUser) redirect("/login");

  const isManagement = currentUser.role.key === "admin" || currentUser.role.key === "team_lead";

  return (
    <TicketsClient
      currentUser={{
        id: currentUser.id,
        name: currentUser.name,
        email: currentUser.email,
        role: currentUser.role.key,
      }}
      isManagement={isManagement}
    />
  );
}
