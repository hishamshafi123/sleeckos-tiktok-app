import prisma from "@/lib/db";
import { Campaign, CampaignResource, CampaignStatus } from "@prisma/client";
import { normalizeCaption } from "@/lib/services/analytics/recover";

/**
 * Thrown when a campaign create/update tries to use a fixed caption that
 * another campaign already uses. Captions are the caption-match recovery
 * signal (see analytics/recover.ts), so a shared caption would make video
 * attribution ambiguous. Routes map this to HTTP 409.
 */
export class FixedTextConflictError extends Error {
  conflictTitle: string;
  constructor(conflictTitle: string) {
    super(
      `This caption is already used by campaign '${conflictTitle}'. Change it or clear the other campaign's caption first.`
    );
    this.name = "FixedTextConflictError";
    this.conflictTitle = conflictTitle;
  }
}

/** Reject when any normalized fixedText is already used by another campaign. */
async function assertFixedTextsUnique(
  fixedTexts: string[] | undefined,
  excludeId?: string
): Promise<void> {
  const normalized = new Set(
    (fixedTexts ?? []).map(normalizeCaption).filter((c) => c.length > 0)
  );
  if (normalized.size === 0) return;

  const others = await prisma.campaign.findMany({
    where: excludeId ? { id: { not: excludeId } } : {},
    select: { title: true, fixedTexts: true },
  });
  for (const other of others) {
    if (other.fixedTexts.some((t) => normalized.has(normalizeCaption(t)))) {
      throw new FixedTextConflictError(other.title);
    }
  }
}

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
  await assertFixedTextsUnique(data.fixedTexts);

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
  if (data.fixedTexts !== undefined) {
    await assertFixedTextsUnique(data.fixedTexts, id);
  }

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
