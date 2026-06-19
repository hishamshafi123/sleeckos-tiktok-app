import React from "react";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { redirect } from "next/navigation";
import AccessDenied from "@/components/AccessDenied";
import prisma from "@/lib/db";
import LmsClient from "./LmsClient";

export const dynamic = "force-dynamic";

export default async function LMSPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const hasAccess = await can(session.userId, "lms");
  if (!hasAccess) {
    return <AccessDenied tool="LMS Academy" />;
  }

  const currentUser = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { role: true },
  });

  if (!currentUser) redirect("/login");

  const isAdmin = currentUser.role.key === "admin" || currentUser.role.key === "team_lead";

  // Fetch available roles for course assignment
  const roles = await prisma.role.findMany({
    select: { key: true, label: true },
    orderBy: { key: "asc" },
  });

  // Fetch all tool keys used in the system for unlockToolKey selection
  const toolKeys = [
    "clip_mixer",
    "style_studio",
    "composer",
    "multiplier",
    "accounts",
    "campaigns",
    "projects",
    "sourcing",
    "users_access",
    "lms",
  ];

  return (
    <LmsClient
      currentUser={{
        id: currentUser.id,
        name: currentUser.name,
        email: currentUser.email,
        role: currentUser.role.key,
      }}
      isAdmin={isAdmin}
      roles={roles}
      toolKeys={toolKeys}
    />
  );
}
