export const dynamic = "force-dynamic";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { redirect } from "next/navigation";
import AccessDenied from "@/components/AccessDenied";
import ClientPage from "./ClientPage";
import { Suspense } from "react";

export default async function Page(props: any) {
  const session = await getSession();
  if (!session) redirect("/login");

  const isAllowed = await can(session.userId, "clip_mixer");
  if (!isAllowed) {
    return <AccessDenied tool="Clip Mixer" />;
  }

  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[400px] text-gray-500">
        Loading Smart Clip Mixer...
      </div>
    }>
      <ClientPage {...props} />
    </Suspense>
  );
}
