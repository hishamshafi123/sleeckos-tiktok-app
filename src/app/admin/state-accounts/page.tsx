import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import AccessDenied from "@/components/AccessDenied";
import { stateAccess } from "@/lib/services/state-accounts/data";
import ClientPage from "./ClientPage";
export const dynamic = "force-dynamic";
export default async function Page() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await stateAccess(session.userId, session.role)))
    return <AccessDenied tool="State Accounts" />;
  return <ClientPage />;
}
