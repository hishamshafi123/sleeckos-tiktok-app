export const dynamic = "force-dynamic";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function HomePage() {
  const session = await getSession();
  if (session && session.role === "ADMIN") {
    redirect("/admin");
  }
  redirect("/login");
}
