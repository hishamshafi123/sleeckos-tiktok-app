export const dynamic = "force-dynamic";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { redirect } from "next/navigation";
import AccessDenied from "@/components/AccessDenied";
import prisma from "@/lib/db";
import ClientPage from "./ClientPage";

export default async function Page(props: any) {
  const session = await getSession();
  if (!session) redirect("/login");

  const isAllowed = await can(session.userId, "history");
  if (!isAllowed) {
    return <AccessDenied tool="History" />;
  }

  // Options for the campaign multi-select filter (the managed campaigns route
  // is guarded by a different tool key, so the list is loaded here).
  const campaigns = await prisma.campaign.findMany({
    orderBy: { title: "asc" },
    select: { id: true, title: true },
  });

  return <ClientPage {...props} allCampaigns={campaigns} />;
}
