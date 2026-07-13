import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import prisma from "@/lib/db";
import { getOrgTimezone } from "@/lib/services/timezone";
import KpiClientPage from "./ClientPage";

export const dynamic = "force-dynamic";

export default async function KpiPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const currentUser = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { role: true },
  });

  if (!currentUser) redirect("/login");

  const tz = await getOrgTimezone();

  return (
    <KpiClientPage
      currentUserId={session.userId}
      userRole={currentUser.role.key}
      orgTimezone={tz}
    />
  );
}
