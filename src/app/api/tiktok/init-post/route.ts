export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { initDirectPost } from "@/lib/tiktok";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { deliverableId, ...postData } = body;

  const account = await prisma.tiktokAccount.findFirst({
    where: { userId: session.userId, revokedAt: null },
  });
  if (!account) return NextResponse.json({ error: "No connected TikTok account" }, { status: 400 });

  const payload = {
    post_info: {
      title: postData.title,
      privacy_level: postData.privacy_level,
      disable_comment: postData.disable_comment ?? false,
      disable_duet: postData.disable_duet ?? false,
      disable_stitch: postData.disable_stitch ?? false,
      video_cover_timestamp_ms: postData.video_cover_timestamp_ms ?? 0,
      brand_content_toggle: true, // Always forced on
      brand_organic_toggle: false,
    },
    source_info: {
      source: "FILE_UPLOAD",
      video_size: postData.video_size || 5000000,
      chunk_size: postData.chunk_size || 5000000,
      total_chunk_count: postData.total_chunk_count || 1,
    },
  };

  try {
    const data = await initDirectPost(account.accessToken, payload);

    await prisma.auditLog.create({
      data: {
        actorUserId: session.userId,
        action: "TIKTOK_API_CALL",
        resourceType: "Deliverable",
        resourceId: deliverableId || null,
        metadata: { endpoint: "/v2/post/publish/video/init/", response: data },
      },
    });

    if (data.error && data.error.code !== "ok") {
      return NextResponse.json({ error: data.error.message }, { status: 400 });
    }

    const publishId = data.data?.publish_id;

    if (deliverableId && publishId) {
      await prisma.deliverable.update({
        where: { id: deliverableId },
        data: { publishId, status: "PUBLISHED" },
      });
    }

    return NextResponse.json({ publishId, uploadUrl: data.data?.upload_url });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
