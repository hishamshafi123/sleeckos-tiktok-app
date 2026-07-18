export const dynamic = "force-dynamic";

import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { redirect, notFound } from "next/navigation";
import AccessDenied from "@/components/AccessDenied";
import CampaignDetailClient from "./CampaignDetailClient";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminCampaignDetailPage({ params }: PageProps) {
  const session = await getSession();
  if (!session) redirect("/login");

  const hasAccess = await can(session.userId, "campaigns");
  if (!hasAccess) {
    return <AccessDenied tool="Campaigns" />;
  }

  const { id } = await params;

  // Retrieve the campaign with its resources
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      resources: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!campaign) {
    notFound();
  }

  // Retrieve smart-export analytics for this campaign
  const totalExported = await prisma.smartExportAssignment.count({
    where: {
      status: "done",
      video: {
        group: {
          campaignId: id,
        },
      },
    },
  });

  const exportsList = await prisma.smartExportAssignment.findMany({
    where: {
      status: "done",
      video: {
        group: {
          campaignId: id,
        },
      },
    },
    select: {
      video: {
        select: {
          id: true,
          exportedAt: true,
        },
      },
    },
  });

  // Sort by video.exportedAt asc
  exportsList.sort((a, b) => {
    const t1 = a.video.exportedAt ? new Date(a.video.exportedAt).getTime() : 0;
    const t2 = b.video.exportedAt ? new Date(b.video.exportedAt).getTime() : 0;
    return t1 - t2;
  });

  // Group daily exports YYYY-MM-DD
  const dailyMap: Record<string, number> = {};
  exportsList.forEach((e) => {
    if (e.video.exportedAt) {
      const dateStr = e.video.exportedAt.toISOString().split("T")[0];
      dailyMap[dateStr] = (dailyMap[dateStr] || 0) + 1;
    }
  });
  const dailyExports = Object.entries(dailyMap).map(([date, count]) => ({ date, count }));

  // Get recent 5 exports
  const recentAssignments = await prisma.smartExportAssignment.findMany({
    where: {
      status: "done",
      video: {
        group: {
          campaignId: id,
        },
      },
    },
    select: {
      id: true,
      driveFolderId: true,
      video: {
        select: {
          id: true,
          exportedAt: true,
          hook: {
            select: {
              text: true,
            },
          },
          group: {
            select: {
              name: true,
            },
          },
        },
      },
    },
    take: 5,
  });

  // Sort recent assignments by video.exportedAt desc
  recentAssignments.sort((a, b) => {
    const t1 = a.video.exportedAt ? new Date(a.video.exportedAt).getTime() : 0;
    const t2 = b.video.exportedAt ? new Date(b.video.exportedAt).getTime() : 0;
    return t2 - t1;
  });

  const folderIds = recentAssignments.map((a) => a.driveFolderId);
  const accounts = await prisma.managedAccount.findMany({
    where: { driveFolderId: { in: folderIds } },
    select: { driveFolderId: true, driveFolderName: true, tiktokUsername: true },
  });
  const folderMap = new Map<string, { folderName: string; username: string }>();
  accounts.forEach((acc) => {
    if (acc.driveFolderId) {
      folderMap.set(acc.driveFolderId, {
        folderName: acc.driveFolderName || "Drive Link",
        username: acc.tiktokUsername,
      });
    }
  });

  const cleanCampaignSlug = (campaign.title || campaign.name || "campaign")
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .substring(0, 30);

  const recentExports = recentAssignments.map((a) => {
    const meta = folderMap.get(a.driveFolderId);
    
    // Construct the actual filename as it was uploaded to drive
    const hookText = a.video.hook?.text || "video";
    const cleanHookSlug = hookText
      .replace(/[^a-zA-Z0-9 ]/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .substring(0, 40);
    const driveFileName = `${cleanCampaignSlug}_${cleanHookSlug}_${a.video.id}.mp4`;

    return {
      id: a.id,
      updatedAt: a.video.exportedAt ? a.video.exportedAt.toISOString() : new Date().toISOString(),
      driveFolderId: a.driveFolderId,
      driveFolderName: meta?.folderName || "Folder Link",
      tiktokUsername: meta?.username || "Account",
      video: {
        id: a.video.id,
        driveFileName,
        group: {
          name: a.video.group.name,
        },
      },
    };
  });

  // Get groups breakdown
  const groups = await prisma.multiplierGroup.findMany({
    where: {
      campaignId: id,
    },
    select: {
      id: true,
      name: true,
      status: true,
      createdAt: true,
      _count: {
        select: {
          outputs: true,
        },
      },
      outputs: {
        where: {
          exportStatus: "exported",
        },
        select: {
          id: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const groupsBreakdown = groups.map((g) => ({
    id: g.id,
    name: g.name,
    status: g.status,
    totalOutputs: g._count.outputs,
    exportedCount: g.outputs.length,
  }));

  const exportAnalytics = {
    totalExported,
    dailyExports,
    recentExports,
    groupsBreakdown,
  };

  return <CampaignDetailClient campaign={campaign} exportAnalytics={exportAnalytics} />;
}
