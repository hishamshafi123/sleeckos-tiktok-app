export const dynamic = "force-dynamic";

import React from "react";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { redirect } from "next/navigation";
import AccessDenied from "@/components/AccessDenied";
import MigrationReportClientPage from "./ClientPage";

export default async function Page() {
  const session = await getSession();
  if (!session) redirect("/login");

  const isAllowed = await can(session.userId, "users_access");
  if (!isAllowed) {
    return <AccessDenied tool="Migration Report" />;
  }

  return <MigrationReportClientPage />;
}
