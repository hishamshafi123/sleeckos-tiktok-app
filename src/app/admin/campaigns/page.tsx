export const dynamic = "force-dynamic";

import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { redirect } from "next/navigation";
import AccessDenied from "@/components/AccessDenied";
import CampaignsClient from "./CampaignsClient";

export default async function AdminCampaignsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const hasAccess = await can(session.userId, "campaigns");
  if (!hasAccess) {
    return <AccessDenied tool="Campaigns" />;
  }

  // Fetch campaigns with resource count from DB
  const campaigns = await prisma.campaign.findMany({
    orderBy: { createdAt: "desc" },
  });

  return <CampaignsClient initialCampaigns={campaigns} />;
}
