export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { STOPWORDS } from "@/lib/youtube";

// Custom keyword-based text relevance scoring helper
function calculateRelevance(title: string, description: string, context: string): number {
  if (!context || !context.trim()) return 0;
  
  const cleanText = (text: string) => text.toLowerCase().replace(/[^\w\s]/g, " ");
  
  const contextWords = cleanText(context)
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
  
  if (contextWords.length === 0) return 0;
  
  const titleLower = cleanText(title);
  const descLower = cleanText(description);
  
  let score = 0;
  
  for (const word of contextWords) {
    // Title matches are heavily weighted (10 points)
    const titleRegex = new RegExp(`\\b${word}\\b`, "g");
    const titleMatches = (titleLower.match(titleRegex) || []).length;
    score += titleMatches * 10;
    
    // Description matches get 2 points
    const descRegex = new RegExp(`\\b${word}\\b`, "g");
    const descMatches = (descLower.match(descRegex) || []).length;
    score += descMatches * 2;
  }
  
  // Phrase matching bonus
  const cleanContext = cleanText(context).trim();
  if (cleanContext.length > 3) {
    if (titleLower.includes(cleanContext)) {
      score += 50; // Exact title match bonus
    } else if (descLower.includes(cleanContext)) {
      score += 20; // Exact description match bonus
    }
  }
  
  return score;
}

// GET /api/managed/videos?nicheId=xxx&status=NEW&sortBy=recent&nicheContext=xxx
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "accounts"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const nicheId = req.nextUrl.searchParams.get("nicheId");
  const status = req.nextUrl.searchParams.get("status");
  const sortBy = req.nextUrl.searchParams.get("sortBy") || "discovered";
  const nicheContext = req.nextUrl.searchParams.get("nicheContext") || "";
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") || "50", 10), 100);
  const offset = parseInt(req.nextUrl.searchParams.get("offset") || "0", 10);

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Clean up older videos (status NEW or SKIPPED) that are older than 24 hours
  await prisma.sourcedVideo.deleteMany({
    where: {
      status: { in: ["NEW", "SKIPPED"] },
      OR: [
        { publishedAt: { lt: twentyFourHoursAgo } },
        { discoveredAt: { lt: twentyFourHoursAgo } },
      ],
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  if (nicheId) where.nicheId = nicheId;
  if (status) where.status = status;
  
  // Strict 24-hour window: only show videos published in the last 24 hours
  where.publishedAt = { gte: twentyFourHoursAgo };

  // If in relevance or combined sort mode, retrieve all videos to sort in memory
  if (sortBy === "relevance" || sortBy === "combined") {
    let searchContext = nicheContext;
    if (!searchContext && nicheId) {
      const niche = await prisma.sourcingNiche.findUnique({
        where: { id: nicheId },
        select: { name: true, description: true }
      });
      if (niche) {
        searchContext = niche.description || niche.name || "";
      }
    }

    const videos = await prisma.sourcedVideo.findMany({
      where,
      include: {
        source: { select: { title: true, type: true } },
        niche: { select: { name: true, color: true } },
      },
    });

    const videosWithScores = videos.map((v) => {
      const score = calculateRelevance(v.title, v.description || "", searchContext);
      return { ...v, relevanceScore: score };
    });

    let sortedVideos = [...videosWithScores];

    if (sortBy === "relevance") {
      // Rank by relevance score desc. If equal, sort by date desc.
      sortedVideos.sort((a, b) => {
        if (b.relevanceScore !== a.relevanceScore) {
          return b.relevanceScore - a.relevanceScore;
        }
        return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
      });
    } else {
      // Combined sort: Find latest videos that match the sub niche
      // Filter out non-matching (score === 0)
      const matchingVideos = sortedVideos.filter(v => v.relevanceScore > 0);
      if (matchingVideos.length > 0) {
        sortedVideos = matchingVideos;
        sortedVideos.sort((a, b) => {
          // Primarily publishedAt desc
          const dateDiff = new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
          if (dateDiff !== 0) return dateDiff;
          // Tie break with relevanceScore desc
          return b.relevanceScore - a.relevanceScore;
        });
      } else {
        // If nothing matches the custom niche context, fall back to sorting by publishedAt desc
        sortedVideos.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
      }
    }

    const total = sortedVideos.length;
    const paginated = sortedVideos.slice(offset, offset + limit);

    const serializedVideos = paginated.map((v) => ({
      ...v,
      viewCount: v.viewCount.toString(),
      likeCount: v.likeCount.toString(),
      commentCount: v.commentCount.toString(),
    }));

    return NextResponse.json({ videos: serializedVideos, total, limit, offset });
  }

  // Normal database-level sorting for other options (discovered, recent, views, likes)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let orderBy: any;
  switch (sortBy) {
    case "recent": orderBy = { publishedAt: "desc" }; break;
    case "views": orderBy = { viewCount: "desc" }; break;
    case "likes": orderBy = { likeCount: "desc" }; break;
    default: orderBy = { discoveredAt: "desc" };
  }

  const [videos, total] = await Promise.all([
    prisma.sourcedVideo.findMany({
      where, orderBy, take: limit, skip: offset,
      include: {
        source: { select: { title: true, type: true } },
        niche: { select: { name: true, color: true } },
      },
    }),
    prisma.sourcedVideo.count({ where }),
  ]);

  const serializedVideos = videos.map((v) => ({
    ...v,
    viewCount: v.viewCount.toString(),
    likeCount: v.likeCount.toString(),
    commentCount: v.commentCount.toString(),
  }));

  return NextResponse.json({ videos: serializedVideos, total, limit, offset });
}

// DELETE /api/managed/videos?nicheId=xxx
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "accounts"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const nicheId = req.nextUrl.searchParams.get("nicheId");
  if (!nicheId) {
    return NextResponse.json({ error: "nicheId is required" }, { status: 400 });
  }

  // Delete all videos with status NEW or SKIPPED for the specified nicheId
  const result = await prisma.sourcedVideo.deleteMany({
    where: {
      nicheId,
      status: { in: ["NEW", "SKIPPED"] },
    },
  });

  return NextResponse.json({ success: true, count: result.count });
}
