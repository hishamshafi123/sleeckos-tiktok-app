export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const publishId = searchParams.get("publish_id");
  const deliverableId = searchParams.get("deliverable_id");

  const account = await prisma.tiktokAccount.findFirst({
    where: { userId: session.userId, revokedAt: null },
  });
  if (!account) return NextResponse.json({ error: "No connected account" }, { status: 400 });

  if (!publishId) return NextResponse.json({ error: "Missing publish_id" }, { status: 400 });

  const res = await fetch("https://open.tiktokapis.com/v2/post/publish/status/fetch/", {
    method: "POST",
    headers: { Authorization: `Bearer ${account.accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ publish_id: publishId }),
  });

  const data = await res.json();

  await prisma.auditLog.create({
    data: {
      actorUserId: session.userId,
      action: "TIKTOK_API_CALL",
      resourceType: "Deliverable",
      resourceId: deliverableId || null,
      metadata: { endpoint: "/v2/post/publish/status/fetch/", publish_id: publishId, response: data },
    },
  });

  if (deliverableId && data.data?.status === "PUBLISH_COMPLETE") {
    await prisma.deliverable.update({
      where: { id: deliverableId },
      data: {
        status: "PUBLISHED",
        tiktokVideoId: data.data?.publicaly_available_post_id?.[0] || null,
        publishedAt: new Date(),
      },
    });
  }

  return NextResponse.json(data);
}
