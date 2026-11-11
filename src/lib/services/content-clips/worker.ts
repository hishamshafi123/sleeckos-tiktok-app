import prisma from "@/lib/db";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { asJson } from "./data";
import {
  importVideo,
  mediaPath,
  normalizeVideo,
  command,
  probe,
} from "./media";
import {
  validateWords,
  type Draft,
  type Word,
} from "../../content-clips/schema";
import { suggestClips } from "./ai";
import { renderClip } from "./render";
const LEASE = 120000;
async function transcribe(file: string, work: string, signal: AbortSignal) {
  const info = await probe(file);
  if (!info.audio)
    throw new Error(
      "This video has no audio track. Trim it manually and write a hook, or choose another source.",
    );
  const output = path.join(work, "transcript.json");
  await command(
    process.env.CONTENT_CLIP_PYTHON || "./venv/bin/python3",
    ["scripts/content_clip_transcribe.py", file, output],
    900000,
    signal,
  );
  return validateWords(
    JSON.parse(await fs.promises.readFile(output, "utf8")),
    info.duration,
  );
}
export const clipProcessors = {
  importVideo,
  normalizeVideo,
  transcribe,
  suggestClips,
  renderClip,
};
export async function runClipJobs(limit = 1, processors = clipProcessors) {
  let processed = 0;
  for (let count = 0; count < limit; count++) {
    const owner = randomUUID();
    const job = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(893286)`;
      await tx.contentClipJob.updateMany({
        where: {
          status: "RUNNING",
          leaseUntil: { lt: new Date() },
          attempts: { gte: 2 },
        },
        data: {
          status: "FAILED",
          stage: "Interrupted",
          error:
            "The worker stopped twice before finishing. Retry this step; your saved edits are preserved.",
          owner: null,
        },
      });
      await tx.contentClipJob.updateMany({
        where: {
          status: "RUNNING",
          leaseUntil: { lt: new Date() },
          attempts: { lt: 2 },
        },
        data: {
          status: "QUEUED",
          stage: "Recovering interrupted job",
          owner: null,
        },
      });
      if (
        await tx.contentClipJob.count({
          where: { status: "RUNNING", leaseUntil: { gte: new Date() } },
        })
      )
        return null;
      const next = await tx.contentClipJob.findFirst({
        where: { status: "QUEUED" },
        orderBy: { createdAt: "asc" },
      });
      if (!next) return null;
      return tx.contentClipJob.update({
        where: { id: next.id },
        data: {
          status: "RUNNING",
          owner,
          leaseUntil: new Date(Date.now() + LEASE),
          attempts: { increment: 1 },
          error: null,
        },
        include: { clip: { include: { story: { include: { state: true } } } } },
      });
    });
    if (!job) break;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25 * 60000);
    const heartbeat = setInterval(() => {
      void prisma.contentClipJob
        .updateMany({
          where: { id: job.id, owner, status: "RUNNING" },
          data: { leaseUntil: new Date(Date.now() + LEASE) },
        })
        .then((r) => {
          if (!r.count) controller.abort();
        })
        .catch(() => controller.abort());
    }, 30000);
    const work = mediaPath(`${job.clipId}/${job.id}-${owner}`);
    let stage = "Preparing video";
    const progress = async (label: string) => {
      stage = label;
      const updated = await prisma.contentClipJob.updateMany({
        where: { id: job.id, owner, status: "RUNNING" },
        data: { stage: label },
      });
      if (!updated.count || controller.signal.aborted)
        throw new Error("The job was interrupted. Retry this step.");
    };
    const persist = async (
      data: Prisma.ContentClipUpdateInput,
      expectedTranscript?: number,
    ) => {
      await prisma.$transaction(async (tx) => {
        const held = await tx.contentClipJob.updateMany({
          where: {
            id: job.id,
            owner,
            status: "RUNNING",
            leaseUntil: { gt: new Date() },
          },
          data: { stage },
        });
        if (!held.count || controller.signal.aborted)
          throw new Error("The job was interrupted. Retry this step.");
        const updated = await tx.contentClip.updateMany({
          where: {
            id: job.clipId,
            ...(expectedTranscript !== undefined
              ? { transcriptVersion: expectedTranscript }
              : {}),
          },
          data,
        });
        if (!updated.count)
          throw new Error(
            "The transcript changed during analysis. Run suggestions again using the saved corrections.",
          );
      });
    };
    try {
      await fs.promises.mkdir(work, { recursive: true });
      const payload = job.payload as {
        uploadPath?: string;
        draft: Draft;
        words: Word[];
        length?: number;
        selection?: { start: number; end: number };
        transcriptVersion: number;
      };
      let source = job.clip.sourcePath;
      let duration = job.clip.duration || 0;
      if (job.kind === "IMPORT" && !source) {
        await progress(
          payload.uploadPath
            ? "Preparing uploaded video"
            : "Downloading source",
        );
        const input = payload.uploadPath
          ? mediaPath(payload.uploadPath)
          : await processors.importVideo(
              job.clip.sourceUrl!,
              work,
              controller.signal,
            );
        await progress("Preparing video preview");
        const relative = `${job.clipId}/source-${owner}.mp4`;
        const info = await processors.normalizeVideo(
          input,
          mediaPath(relative),
          controller.signal,
        );
        duration = info.duration;
        source = relative;
        const draft = job.clip.draft as Draft;
        await persist({
          sourcePath: source,
          duration,
          draft: asJson({ ...draft, end: Math.min(30, duration) }),
          version: { increment: 1 },
        });
        if (payload.uploadPath) await fs.promises.rm(input, { force: true });
      } else if (job.kind === "ANALYZE" || job.kind === "SUGGEST") {
        let words = job.clip.transcript as Word[] | null;
        let transcriptVersion = job.clip.transcriptVersion;
        if (!words && job.kind === "ANALYZE") {
          await progress("Transcribing speech");
          words = await processors.transcribe(
            mediaPath(source!),
            work,
            controller.signal,
          );
          if (!words.length)
            throw new Error(
              "No speech was detected. Edit this video manually or choose another source.",
            );
          await persist(
            {
              transcript: asJson(words),
              transcriptVersion: { increment: 1 },
              version: { increment: 1 },
            },
            transcriptVersion,
          );
          transcriptVersion++;
        }
        await progress(
          payload.selection
            ? "Writing hooks for your selection"
            : "Finding useful clips",
        );
        const clips = await processors.suggestClips(
          words || [],
          duration,
          job.clip.story.title,
          job.clip.story.state.name,
          payload.length || 60,
          payload.selection,
        );
        await persist(
          {
            suggestions: asJson({
              clips,
              transcriptVersion,
              selection: payload.selection || null,
              createdAt: new Date().toISOString(),
            }),
          },
          transcriptVersion,
        );
      } else if (job.kind === "RENDER") {
        await progress("Rendering video");
        const relative = `${job.clipId}/export-${job.id}-${owner}.mp4`;
        await processors.renderClip(
          mediaPath(source!),
          mediaPath(relative),
          payload.draft,
          payload.words,
          controller.signal,
        );
        const info = await probe(mediaPath(relative));
        const expected =
          payload.draft.end -
          payload.draft.start +
          (payload.draft.outro === "none" ? 0 : 3);
        if (Math.abs(info.duration - expected) > 0.3)
          throw new Error(
            "Export duration did not match your selection. Retry export.",
          );
        const held = await prisma.contentClipJob.updateMany({
          where: {
            id: job.id,
            owner,
            status: "RUNNING",
            leaseUntil: { gt: new Date() },
          },
          data: { outputPath: relative },
        });
        if (!held.count) {
          await fs.promises.rm(mediaPath(relative), { force: true });
          throw new Error("Export was interrupted. Retry export.");
        }
      }
      await prisma.contentClipJob.updateMany({
        where: { id: job.id, owner, status: "RUNNING" },
        data: {
          status: "COMPLETED",
          stage: job.kind === "RENDER" ? "Ready to post" : "Ready",
          owner: null,
          leaseUntil: null,
        },
      });
    } catch (error) {
      const raw = error instanceof Error ? error.message : "Unknown error";
      const message =
        /Command failed|ENOENT|ETIMEDOUT|ECONN|signal|timeout|ERR_/i.test(raw)
          ? `${stage} failed or timed out. Retry this step. If it repeats, ask an admin to check the media worker.`
          : raw.slice(0, 500);
      console.error(
        `[Clip Studio] ${job.kind} failed for job ${job.id}: ${message}`,
      );
      await prisma.contentClipJob.updateMany({
        where: { id: job.id, owner },
        data: {
          status: "FAILED",
          error: message,
          stage,
          owner: null,
          leaseUntil: null,
        },
      });
    } finally {
      clearTimeout(timeout);
      clearInterval(heartbeat);
      await fs.promises.rm(work, { recursive: true, force: true });
    }
    processed++;
  }
  return { processed };
}
