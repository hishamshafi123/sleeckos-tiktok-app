import type { Metadata } from "next";
import { redirect } from "next/navigation";
import StatePortalClient from "./StatePortalClient";

export const metadata: Metadata = {
  title: "State Accounts — Live Performance · SleeckOS",
  description: "Live performance analytics and results for TikTok state accounts.",
  robots: { index: false, follow: false },
};

export default async function StateAccountsClientPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params?.code) ? params.code[0] : params?.code;
  const code = raw?.trim().toUpperCase();
  if (code) {
    redirect(`/state-accounts/${encodeURIComponent(code)}`);
  }
  return <StatePortalClient />;
}
