import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AdminTeamPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  
  redirect("/admin/users-access");
}
