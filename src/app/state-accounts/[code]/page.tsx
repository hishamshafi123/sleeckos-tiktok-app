import type { Metadata } from "next";
import {
  findValidStateShare,
  getClientPortalPayload,
  type StateAccessScope,
} from "@/lib/services/state-accounts/client-portal";
import StatePortalClient from "../StatePortalClient";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ code: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code: rawCode } = await params;
  const code = decodeURIComponent(rawCode || "").trim().toUpperCase();
  const share = code ? await findValidStateShare(code) : null;

  if (!share || (!share.allStates && share.stateNames.length === 0)) {
    return {
      title: "Report Unavailable · SleeckOS",
      description: "This state accounts report link is unavailable or expired.",
      robots: { index: false, follow: false },
    };
  }

  return {
    title: `${share.title} — State Accounts · SleeckOS`,
    description: "Live performance analytics and results for TikTok state accounts.",
    robots: { index: false, follow: false },
  };
}

export default async function StateAccountsDirectLinkPage({
  params,
}: PageProps) {
  const { code: rawCode } = await params;
  const code = decodeURIComponent(rawCode || "").trim().toUpperCase();
  const share = code ? await findValidStateShare(code) : null;

  if (!share || (!share.allStates && share.stateNames.length === 0)) {
    return <StatePortalClient invalidLink />;
  }

  const scope: StateAccessScope = {
    source: "share",
    id: share.id,
    title: share.title,
    allStates: share.allStates,
    stateNames: share.stateNames,
  };

  const payload = await getClientPortalPayload(scope);

  return (
    <StatePortalClient
      initialData={payload}
      initialCode={share.code}
      directLink
    />
  );
}
