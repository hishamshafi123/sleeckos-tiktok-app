import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { getSession } from "@/lib/session";
import { checkPostStatus } from "@/lib/tiktok";

const prisma = new PrismaClient();

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { publishId } = await request.json();

  const job = await prisma.publishJob.findFirst({
    where: { publishId },
    include: { tiktokAccount: true }
  });

  if (!job || job.tiktokAccount.userId !== session.userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const data = await checkPostStatus(job.tiktokAccount.accessToken, publishId);
    
    if (data.error && data.error.code !== "ok") {
      return NextResponse.json({ error: data.error.message }, { status: 400 });
    }

    const newStatus = data.data.status;
    const failReason = data.data.fail_reason;
    const postUrl = data.data.public_post_id ? `https://www.tiktok.com/@${job.tiktokAccount.username}/video/${data.data.public_post_id}` : null;

    if (job.status !== newStatus) {
      await prisma.publishJob.update({
        where: { id: job.id },
        data: { 
          status: newStatus,
          failReason,
          tiktokPostUrl: postUrl || job.tiktokPostUrl
        }
      });
    }

    return NextResponse.json({
      status: newStatus,
      failReason,
      publicPostUrl: postUrl
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
