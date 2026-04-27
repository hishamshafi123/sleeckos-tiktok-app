export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { initDirectPost } from "@/lib/tiktok";


export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();

  const account = await prisma.tiktokAccount.findFirst({
    where: { userId: session.userId, revokedAt: null }
  });

  if (!account) return NextResponse.json({ error: "No connected account" }, { status: 400 });

  // For the demo, we simulate FILE_UPLOAD by just initializing it
  // In a real app we would compute exact video size and send chunk_size etc.
  const payload = {
    post_info: {
      title: body.title,
      privacy_level: body.privacy_level,
      disable_comment: body.disable_comment,
      disable_duet: body.disable_duet,
      disable_stitch: body.disable_stitch,
      video_cover_timestamp_ms: body.video_cover_timestamp_ms,
      brand_content_toggle: body.brand_content_toggle,
      brand_organic_toggle: body.brand_organic_toggle,
    },
    source_info: {
      source: "FILE_UPLOAD",
      video_size: 5000000, // Dummy
      chunk_size: 5000000,
      total_chunk_count: 1
    }
  };

  try {
    const data = await initDirectPost(account.accessToken, payload);
    
    if (data.error && data.error.code !== "ok") {
      return NextResponse.json({ error: data.error.message }, { status: 400 });
    }

    const publishId = data.data.publish_id;

    await prisma.publishJob.create({
      data: {
        tiktokAccountId: account.id,
        publishId,
        sourceType: "FILE_UPLOAD",
        caption: body.title,
        privacyLevel: body.privacy_level,
        disableComment: body.disable_comment,
        disableDuet: body.disable_duet,
        disableStitch: body.disable_stitch,
        coverTimestampMs: body.video_cover_timestamp_ms,
        brandContentToggle: body.brand_content_toggle,
        brandOrganicToggle: body.brand_organic_toggle,
        status: "INITIALIZED",
      }
    });

    // In a real app we would start uploading chunks to data.data.upload_url now.
    // We'll update status to PUBLISHED immediately for demo purposes if we don't implement full chunk upload.
    // Wait, the PRD requires the UI to poll the status API, so we should actually just return the publishId.

    return NextResponse.json({ publishId, uploadUrl: data.data.upload_url });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
