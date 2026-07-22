export const dynamic = "force-dynamic";

import React from "react";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { redirect } from "next/navigation";
import AccessDenied from "@/components/AccessDenied";
import DistributionClientPage from "./ClientPage";

export default async function Page() {
  const session = await getSession();
  if (!session) redirect("/login");

  const hasAccess = await can(session.userId, "accounts");
  if (!hasAccess) {
    return <AccessDenied tool="Distribution" />;
  }

  return <DistributionClientPage />;
}
