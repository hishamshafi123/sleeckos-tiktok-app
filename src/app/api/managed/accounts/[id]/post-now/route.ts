export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import {
  ingestDriveFiles,
  claimNextVideo,
  uploadAndPublish,
  pollJobStatus,
} from "@/lib/services/posting-pipeline";

// POST /api/managed/accounts/[id]/post-now — instantly post next video via PostPeer
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "accounts"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const account = await prisma.managedAccount.findUnique({
    where: { id },
    include: { group: { include: { section: true } } },
  });

  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }
  if (!account.driveConnected || !account.driveFolderId) {
    return NextResponse.json(
      { error: "No Google Drive folder linked. Link a folder first in Settings." },
      { status: 400 }
    );
  }
  if (!account.postpeerAccountId) {
    return NextResponse.json(
      { error: "No PostPeer Account ID set. Add it in the account settings." },
      { status: 400 }
    );
  }

  // 1. Ingest files from Drive to update the database state
  try {
    await ingestDriveFiles(account.id);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Drive folder ingestion failed: ${err.message || String(err)}` },
      { status: 500 }
    );
  }

  // 2. Claim the next AVAILABLE post atomically
  const job = await claimNextVideo(account.id, "post-now-button");
  if (!job) {
    return NextResponse.json(
      { error: "No unposted video files in the linked Drive folder." },
      { status: 400 }
    );
  }

  // 3. Compute caption (section overrides group/account)
  let caption = "";
  const sec = account.group.section;
  const sectionHasConfig = (sec.descFixedTextEnabled && sec.descFixedText?.trim()) || (sec.descTags && sec.descTagCount > 0);

  if (sectionHasConfig) {
    if (sec.descFixedTextEnabled && sec.descFixedText?.trim()) {
      caption = sec.descFixedText.trim();
    }
  } else if (account.captionSource === "FILENAME") {
    caption = job.driveFileName!.replace(/\.[^.]+$/, "");
  } else if (account.captionSource === "DEFAULT") {
    if (account.group.defaultDescription) {
      caption = account.group.defaultDescription;
    } else if (account.defaultCaption) {
      caption = account.defaultCaption;
    }
  }

  if (sec.descTags && sec.descTagCount > 0) {
    const allTags = sec.descTags
      .split(",")
      .map((t: string) => t.trim())
      .filter((t: string) => t.length > 0);
    if (allTags.length > 0) {
      const shuffled = [...allTags].sort(() => Math.random() - 0.5);
      const picked = shuffled.slice(0, Math.min(sec.descTagCount, allTags.length));
      const tagLine = picked.join(" ");
      caption = caption ? `${caption}\n\n${tagLine}` : tagLine;
    }
  }

  // 4. Asynchronously start the upload & publish process (handled by pipeline)
  (async () => {
    try {
      await uploadAndPublish(job.id, caption);
      // Run an immediate status poll to complete it faster if upload is quick
      await new Promise((resolve) => setTimeout(resolve, 5000));
      await pollJobStatus(job.id);
    } catch (err) {
      console.error(`[PostNow] Background publish failed for job ${job.id}:`, err);
    }
  })();

  return NextResponse.json({
    ok: true,
    jobId: job.id,
    fileName: job.driveFileName,
    message: `Posting "${job.driveFileName}" via PostPeer...`,
  });
}
