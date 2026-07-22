export const dynamic = "force-dynamic";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { redirect } from "next/navigation";
import AccessDenied from "@/components/AccessDenied";
import ClientPage from "./ClientPage";

export default async function Page() {
  const session = await getSession();
  if (!session) redirect("/login");

  const isAllowed = await can(session.userId, "composer");
  if (!isAllowed) {
    return <AccessDenied tool="Video Factory" />;
  }

  return <ClientPage session={{ userId: session.userId, role: session.role }} />;
}
