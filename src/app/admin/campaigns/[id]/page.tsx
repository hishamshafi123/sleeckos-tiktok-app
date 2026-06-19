export const dynamic = "force-dynamic";

import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { redirect, notFound } from "next/navigation";
import AccessDenied from "@/components/AccessDenied";
import CampaignDetailClient from "./CampaignDetailClient";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminCampaignDetailPage({ params }: PageProps) {
  const session = await getSession();
  if (!session) redirect("/login");

  const hasAccess = await can(session.userId, "campaigns");
  if (!hasAccess) {
    return <AccessDenied tool="Campaigns" />;
  }

  const { id } = await params;

  // Retrieve the campaign with its resources
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      resources: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!campaign) {
    notFound();
  }

  return <CampaignDetailClient campaign={campaign} />;
}
