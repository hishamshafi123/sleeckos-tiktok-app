import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import TeamClientPage from "./TeamClientPage";

export const dynamic = "force-dynamic";

export default async function AdminTeamPage() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") redirect("/login");

  return <TeamClientPage currentUser={{ userId: session.userId, email: session.email }} />;
}
