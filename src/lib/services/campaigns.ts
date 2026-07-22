import prisma from "@/lib/db";
import { Campaign, CampaignResource, CampaignStatus } from "@prisma/client";

export interface CalculatorInputs {
  targetViews: number;
  accountsCount: number;
  avgViewsPerVideo: number;
  videosPerAccountPerDay: number;
}

export interface CalculatorOutputs {
  totalVideosNeeded: number;
  videosPerDay: number;
  viewsPerDay: number;
  daysToGoal: number;
  warning: boolean;
}

/**
 * Pure calculator function to project requirements to hit a target view goal.
 * Safeguarded against division by zero, missing, or negative inputs.
 */
export function calculateProjection(inputs: CalculatorInputs): CalculatorOutputs {
  const { targetViews, accountsCount, avgViewsPerVideo, videosPerAccountPerDay } = inputs;

  // Safeguards
  if (
    targetViews <= 0 ||
    accountsCount <= 0 ||
    avgViewsPerVideo <= 0 ||
    videosPerAccountPerDay <= 0
  ) {
    return {
      totalVideosNeeded: 0,
      videosPerDay: 0,
      viewsPerDay: 0,
      daysToGoal: 0,
      warning: false,
    };
  }

  // TODO: source from historical data (avgViewsPerVideo should pull from historical niche performance in the future)
  const totalVideosNeeded = Math.ceil(targetViews / avgViewsPerVideo);
  const videosPerDay = accountsCount * videosPerAccountPerDay;
  const viewsPerDay = videosPerDay * avgViewsPerVideo;
  const daysToGoal = Math.ceil(totalVideosNeeded / videosPerDay);
  const warning = videosPerAccountPerDay > 3;

  return {
    totalVideosNeeded,
    videosPerDay,
    viewsPerDay,
    daysToGoal,
    warning,
  };
}

export async function getCampaigns() {
  return prisma.campaign.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: { resources: true },
      },
    },
  });
}

export async function getCampaignById(id: string) {
  return prisma.campaign.findUnique({
    where: { id },
    include: {
      resources: {
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

export interface CreateCampaignData {
  title: string;
  name?: string;
  type?: string;
  description?: string;
  brief?: string;
  deliverableFormat?: string;
  deliverableCount?: number;
  payoutPerPostCents?: number;
  totalBudgetCents?: number;
  maxCreators?: number;
  applicationDeadline?: Date;
  deliveryDeadline?: Date;
  targetViews?: number;
  accountsCount?: number;
  avgViewsPerVideo?: number;
  videosPerAccountPerDay?: number;
  infoContent?: string;
  fixedTexts?: string[];
  descTags?: string;
  descTagCount?: number;
  status?: CampaignStatus;
}

export async function createCampaign(data: CreateCampaignData, createdById?: string) {
  // Generate a safe unique slug
  const baseSlug = (data.name || data.title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  
  let slug = baseSlug || "campaign";
  let exists = await prisma.campaign.findUnique({ where: { slug } });
  let counter = 1;
  while (exists) {
    slug = `${baseSlug}-${counter}`;
    exists = await prisma.campaign.findUnique({ where: { slug } });
    counter++;
  }

  return prisma.campaign.create({
    data: {
      title: data.title || data.name || "Untitled Campaign",
      name: data.name || data.title || "Untitled Campaign",
      slug,
      type: data.type || "other",
      createdBy: createdById,
      description: data.description || "",
      brief: data.brief || "",
      deliverableFormat: data.deliverableFormat || "VIDEO",
      deliverableCount: data.deliverableCount ?? 1,
      payoutPerPostCents: data.payoutPerPostCents ?? 0,
      totalBudgetCents: data.totalBudgetCents ?? 0,
      maxCreators: data.maxCreators ?? 5,
      applicationDeadline: data.applicationDeadline || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      deliveryDeadline: data.deliveryDeadline || new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      targetViews: data.targetViews ?? 0,
      accountsCount: data.accountsCount ?? 0,
      avgViewsPerVideo: data.avgViewsPerVideo ?? 0,
      videosPerAccountPerDay: data.videosPerAccountPerDay ?? 0,
      infoContent: data.infoContent || "",
      status: data.status || CampaignStatus.DRAFT,
    },
  });
}

export async function updateCampaign(id: string, data: Partial<CreateCampaignData>) {
  const updateData: any = { ...data };
  
  if (data.title && !data.name) {
    updateData.name = data.title;
  } else if (data.name && !data.title) {
    updateData.title = data.name;
  }

  return prisma.campaign.update({
    where: { id },
    data: updateData,
  });
}

export async function deleteCampaign(id: string) {
  return prisma.campaign.delete({
    where: { id },
  });
}

export async function addCampaignResource(
  campaignId: string,
  resource: { label: string; url: string; type: string }
) {
  return prisma.campaignResource.create({
    data: {
      campaignId,
      label: resource.label,
      url: resource.url,
      type: resource.type,
    },
  });
}

export async function deleteCampaignResource(id: string) {
  return prisma.campaignResource.delete({
    where: { id },
  });
}
