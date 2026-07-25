export const dynamic = "force-dynamic";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import AccessDenied from "@/components/AccessDenied";
import ClientPage from "./ClientPage";

export default async function Page() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (session.role !== "admin") {
    return <AccessDenied tool="Activity" />;
  }

  return <ClientPage />;
}
