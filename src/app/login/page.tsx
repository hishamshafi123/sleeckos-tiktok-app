import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/admin");

  return <LoginForm />;
}
