export const dynamic = "force-dynamic";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { redirect } from "next/navigation";
import AccessDenied from "@/components/AccessDenied";
import ClientPage from "./ClientPage";

export default async function Page(props: any) {
  const session = await getSession();
  if (!session) redirect("/login");

  const isAllowed = await can(session.userId, "composer");
  if (!isAllowed) {
    return <AccessDenied tool="Bulk Genres" />;
  }

  return <ClientPage {...props} />;
}
