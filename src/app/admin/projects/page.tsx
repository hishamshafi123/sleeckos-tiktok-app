import React from "react";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { redirect } from "next/navigation";
import AccessDenied from "@/components/AccessDenied";
import prisma from "@/lib/db";
import ProjectsClient from "./ProjectsClient";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const hasAccess = await can(session.userId, "projects");
  if (!hasAccess) {
    return <AccessDenied tool="Projects" />;
  }

  // Fetch current user and role
  const currentUser = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { role: true },
  });

  if (!currentUser) redirect("/login");

  const isManagement = currentUser.role.key === "admin" || currentUser.role.key === "team_lead";

  // Fetch campaigns for creation / mapping
  const campaigns = await prisma.campaign.findMany({
    select: { id: true, title: true },
    orderBy: { createdAt: "desc" },
  });

  // Fetch users in the system to assign to projects/tasks
  const activeUsers = await prisma.user.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true, email: true, role: { select: { label: true, key: true } } },
    orderBy: { name: "asc" },
  });

  // Fetch Clip Mixer batches to link tasks to output rendering batches
  const clipMixerBatches = await prisma.clipMixerBatch.findMany({
    select: { id: true, targetDuration: true, totalVideos: true, folder: { select: { name: true } }, track: { select: { title: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <ProjectsClient
      currentUser={{
        id: currentUser.id,
        name: currentUser.name,
        email: currentUser.email,
        role: currentUser.role.key,
        telegramChatId: currentUser.telegramChatId,
      }}
      campaigns={campaigns}
      activeUsers={activeUsers}
      clipMixerBatches={clipMixerBatches}
      isManagement={isManagement}
    />
  );
}
