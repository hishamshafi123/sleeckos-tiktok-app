import prisma from "@/lib/db";
import { Prisma } from "@prisma/client";
import {
  defaultDraft,
  validateDraft,
  validateWords,
  type Draft,
} from "../../content-clips/schema";
import { DeskError } from "../content-desk/rules";
import type { Actor } from "../content-desk/data";
import { videoSource } from "./media";
export const asJson = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export async function storyAccess(
  storyId: string,
  actor: Actor,
  write = false,
) {
  const story = await prisma.contentStory.findUnique({
    where: { id: storyId },
    include: { state: true },
  });
  if (!story)
    throw new DeskError("NOT_FOUND", "This story no longer exists.", 404);
  const canEdit =
    actor.role === "admin" ||
    !story.teamId ||
    !!(await prisma.stateTeamMember.findUnique({
      where: { teamId_userId: { teamId: story.teamId, userId: actor.userId } },
    }));
  if (write && !canEdit)
    throw new DeskError(
      "FORBIDDEN",
      "This story belongs to another team. Ask an admin to reassign it.",
      403,
    );
  return { story, canEdit };
}
export async function clipAccess(id: string, actor: Actor, write = false) {
  const clip = await prisma.contentClip.findUnique({ where: { id } });
  if (!clip)
    throw new DeskError("NOT_FOUND", "This video no longer exists.", 404);
  await storyAccess(clip.storyId, actor, write);
  return clip;
}
export async function clipData(storyId: string, actor: Actor) {
  const { canEdit } = await storyAccess(storyId, actor);
  const clips = await prisma.contentClip.findMany({
    where: { storyId },
    orderBy: { createdAt: "desc" },
    include: {
      jobs: {
        take: 20,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          kind: true,
          status: true,
          stage: true,
          error: true,
          outputPath: true,
          createdAt: true,
          payload: true,
        },
      },
    },
  });
  return {
    canEdit,
    clips: clips.map(({ sourcePath, ...clip }) => ({
      ...clip,
      ready: !!sourcePath,
      jobs: clip.jobs.map(({ outputPath, payload, ...job }) => ({
        ...job,
        downloadable: !!outputPath,
        draft:
          job.kind === "RENDER"
            ? (payload as { draft?: unknown }).draft
            : undefined,
      })),
    })),
  };
}
export async function createClip(
  storyId: string,
  sourceName: string,
  sourceUrl: string | null,
  actor: Actor,
) {
  const { story } = await storyAccess(storyId, actor, true);
  if (sourceUrl) sourceUrl = videoSource(sourceUrl).url;
  const defaults = story.accountId
    ? await prisma.appSetting.findUnique({
        where: { key: `content_clip_default_${story.accountId}` },
      })
    : null;
  let draft = defaultDraft(story.state.name, sourceName);
  if (defaults) {
    try {
      draft = {
        ...draft,
        ...JSON.parse(defaults.value),
        start: 0,
        end: 30,
        hook: "",
        credit: sourceName.slice(0, 100),
      };
    } catch {
      /* use starter presets */
    }
  }
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(893285)`;
    if ((await tx.contentClip.count({ where: { storyId } })) >= 20)
      throw new DeskError(
        "LIMIT",
        "This story already has 20 videos. Reuse an existing video.",
      );
    return tx.contentClip.create({
      data: {
        storyId,
        sourceName: sourceName.slice(0, 200),
        sourceUrl,
        draft: asJson(draft),
        createdById: actor.userId,
      },
    });
  });
}
export async function queueClip(
  id: string,
  kind: string,
  actor: Actor,
  options: Record<string, unknown> = {},
  exportSnapshot?: Prisma.InputJsonValue,
) {
  const clip = await clipAccess(id, actor, true);
  if (!["IMPORT", "ANALYZE", "SUGGEST", "RENDER"].includes(kind))
    throw new DeskError("INVALID", "Unknown video action.");
  if (kind !== "IMPORT" && (!clip.sourcePath || !clip.duration))
    throw new DeskError("NOT_READY", "Prepare the source video first.");
  if (kind === "IMPORT" && !clip.sourceUrl && !options.uploadPath)
    throw new DeskError("INVALID", "Upload a video file or add a video link.");
  if (kind === "SUGGEST" && !clip.transcript)
    throw new DeskError("NOT_READY", "Transcribe the video first.");
  let payload: Record<string, unknown> = {
    transcriptVersion: clip.transcriptVersion,
  };
  if (kind === "IMPORT" && typeof options.uploadPath === "string")
    payload.uploadPath = options.uploadPath;
  if (kind === "RENDER") {
    const draft = validateDraft(options.draft || clip.draft, clip.duration!);
    payload = { draft, words: clip.transcript || [], version: clip.version };
  }
  if (kind === "SUGGEST" || kind === "ANALYZE") {
    const length = Number(options.length || 60);
    if (![30, 60, 90].includes(length))
      throw new DeskError("INVALID", "Choose a 30, 60, or 90 second target.");
    payload.length = length;
    if (options.selection) {
      const selection = validateDraft(options.selection, clip.duration!);
      payload.selection = { start: selection.start, end: selection.end };
    }
  }
  if (kind === "RENDER" && exportSnapshot)
    payload = exportSnapshot as Record<string, unknown>;
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(893285)`;
    const active = await tx.contentClipJob.findFirst({
      where: { clipId: id, status: { in: ["QUEUED", "RUNNING"] } },
    });
    if (active) return active;
    if (
      (await tx.contentClipJob.count({
        where: { status: { in: ["QUEUED", "RUNNING"] } },
      })) >= 30
    )
      throw new DeskError(
        "LIMIT",
        "The video queue is full. Retry after a job finishes.",
        429,
      );
    if (
      (await tx.contentClipJob.count({
        where: {
          clipId: id,
          createdAt: { gte: new Date(Date.now() - 86400000) },
        },
      })) >= 60
    )
      throw new DeskError(
        "LIMIT",
        "This video's daily processing limit was reached. Try again tomorrow.",
        429,
      );
    return tx.contentClipJob.create({
      data: { clipId: id, kind, payload: asJson(payload) },
    });
  });
}
export async function saveClip(
  id: string,
  actor: Actor,
  body: Record<string, unknown>,
) {
  const clip = await clipAccess(id, actor, true);
  if (typeof body.version !== "number" || !clip.duration)
    throw new DeskError("INVALID", "Reload the video before saving.");
  const draft =
    body.draft === undefined
      ? undefined
      : validateDraft(body.draft, clip.duration);
  const words =
    body.words === undefined
      ? undefined
      : validateWords(body.words, clip.duration);
  const result = await prisma.contentClip.updateMany({
    where: { id, version: body.version },
    data: {
      ...(draft ? { draft: asJson(draft) } : {}),
      ...(words
        ? {
            transcript: asJson(words),
            transcriptVersion: { increment: 1 },
            suggestions: Prisma.DbNull,
          }
        : {}),
      version: { increment: 1 },
    },
  });
  if (!result.count)
    throw new DeskError(
      "CONFLICT",
      "This draft changed in another tab. Reload the saved draft before continuing.",
      409,
    );
  return { version: body.version + 1 };
}
export async function saveDefaults(id: string, actor: Actor, value: unknown) {
  const clip = await clipAccess(id, actor, true);
  const { story } = await storyAccess(clip.storyId, actor, true);
  if (!story.accountId)
    throw new DeskError(
      "INVALID",
      "Assign the story to a state account before saving its defaults.",
    );
  const d = validateDraft(value, clip.duration || 0);
  const defaults: Partial<Draft> = {
    overlay: d.overlay,
    outro: d.outro,
    brand: d.brand,
    logo: d.logo,
    captions: d.captions,
    crop: d.crop,
    position: d.position,
  };
  await prisma.appSetting.upsert({
    where: { key: `content_clip_default_${story.accountId}` },
    create: {
      key: `content_clip_default_${story.accountId}`,
      value: JSON.stringify(defaults),
    },
    update: { value: JSON.stringify(defaults) },
  });
  return { saved: true };
}

export async function retryClip(id: string, jobId: string, actor: Actor) {
  await clipAccess(id, actor, true);
  const job = await prisma.contentClipJob.findFirst({
    where: { id: jobId, clipId: id, status: "FAILED" },
  });
  if (!job)
    throw new DeskError(
      "INVALID",
      "This failed job no longer exists. Refresh and retry.",
    );
  return queueClip(
    id,
    job.kind,
    actor,
    job.payload as Record<string, unknown>,
    job.kind === "RENDER" ? (job.payload as Prisma.InputJsonValue) : undefined,
  );
}
