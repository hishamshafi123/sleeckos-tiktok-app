import { createHash } from "node:crypto";
import prisma from "@/lib/db";
import type { ContentState, ContentSource } from "@prisma/client";
import { category, publicUrl, relevant, similar } from "./rules";
import type { Candidate } from "./providers";

export async function ingest(
  candidate: Candidate,
  state: ContentState,
  source: ContentSource | null,
  manual = false,
): Promise<string | null> {
  const url = publicUrl(candidate.url);
  const now = new Date();
  // Unknown publication dates remain visible as unknown; never relabel them as fresh.
  if (
    !manual &&
    candidate.publishedAt &&
    candidate.publishedAt.getTime() < now.getTime() - 7 * 86400000
  )
    return null;
  if (
    !manual &&
    !relevant(
      candidate.title,
      candidate.excerpt,
      state.keywords,
      state.excludedKeywords,
    )
  )
    return null;
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`content-state:${state.code}`}))`;
    const old = await tx.contentItem.findUnique({
      where: { stateCode_url: { stateCode: state.code, url } },
    });
    if (old) {
      const changed =
        old.title !== candidate.title || old.excerpt !== candidate.excerpt;
      await tx.contentItem.update({
        where: { id: old.id },
        data: {
          title: candidate.title,
          excerpt: candidate.excerpt,
          lastSeenAt: now,
          views: candidate.views ?? old.views,
          likes: candidate.likes ?? old.likes,
          ...(candidate.views != null
            ? { previousViews: old.views, previousObservedAt: old.lastSeenAt }
            : {}),
          publishedAt: candidate.publishedAt || old.publishedAt,
        },
      });
      if (changed)
        await tx.contentStory.update({
          where: { id: old.storyId },
          data: {
            needsReview: true,
            evidenceHash: "",
            briefAttempts: 0,
            briefNextAt: now,
            version: { increment: 1 },
          },
        });
      return old.storyId;
    }
    const nearby = await tx.contentStory.findMany({
      where: {
        stateCode: state.code,
        createdAt: { gte: new Date(now.getTime() - 3 * 86400000) },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, title: true, status: true },
    });
    const match = nearby.find((story) => similar(candidate.title, story.title));
    const hours = candidate.publishedAt
      ? Math.max(0, (now.getTime() - candidate.publishedAt.getTime()) / 3600000)
      : 96;
    const score = Math.round(
      50 +
        Math.max(0, 25 - hours / 3) +
        (candidate.coverage === "SOCIAL_CAPTION" ? 0 : 10),
    );
    const story = match
      ? await tx.contentStory.update({
          where: { id: match.id },
          data: {
            needsReview: true,
            evidenceHash: "",
            briefAttempts: 0,
            briefNextAt: now,
            version: { increment: 1 },
          },
        })
      : await tx.contentStory.create({
          data: {
            stateCode: state.code,
            title: candidate.title,
            category: category(candidate.title, source?.category),
            score,
            status: manual ? "NEEDS_REVIEW" : "NEW",
          },
        });
    await tx.contentItem.create({
      data: {
        stateCode: state.code,
        storyId: story.id,
        sourceId: source?.id,
        url,
        title: candidate.title,
        excerpt: candidate.excerpt,
        publisher: candidate.publisher,
        platform: candidate.platform,
        publishedAt: candidate.publishedAt,
        coverage: candidate.coverage,
        views: candidate.views,
        likes: candidate.likes,
      },
    });
    return story.id;
  });
}
export function evidenceHash(
  items: { id: string; title: string; excerpt: string }[],
) {
  return createHash("sha256")
    .update(items.map((i) => `${i.id}:${i.title}:${i.excerpt}`).join("\n"))
    .digest("hex");
}
