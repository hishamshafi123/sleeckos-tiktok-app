export const dynamic = "force-dynamic";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { redirect } from "next/navigation";
import AccessDenied from "@/components/AccessDenied";
import StyleLabClient from "./StyleLabClient";
import { Suspense } from "react";

export default async function Page() {
  const session = await getSession();
  if (!session) redirect("/login");

  const isAllowed = await can(session.userId, "style_studio");
  if (!isAllowed) {
    return <AccessDenied tool="Style Lab" />;
  }

  const user = {
    id: session.userId,
    role: session.role || "editor",
  };

  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[400px] text-gray-500">
        Loading Style Lab...
      </div>
    }>
      <StyleLabClient user={user} />
    </Suspense>
  );
}
