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

  // Override the drift-prone postedCount column with live PostJob state counts
  // (one grouped query for all campaigns) so the list's "posts" column matches
  // the campaign stats endpoint and the public API.
  const postedByCampaign = await prisma.postJob.groupBy({
    by: ["campaignId"],
    where: { state: { in: ["PUBLISHED", "PENDING_DELETION", "DELETED"] } },
    _count: { _all: true },
  });
  const postedMap = new Map(postedByCampaign.map((r) => [r.campaignId, r._count._all]));
  const campaignsWithLiveCounts = campaigns.map((c) => ({
    ...c,
    postedCount: postedMap.get(c.id) ?? 0,
  }));

  return <CampaignsClient initialCampaigns={campaignsWithLiveCounts} />;
}
