import { after, NextResponse } from "next/server";
import {
  clipData,
  createClip,
  retryClip,
  queueClip,
  saveClip,
  saveDefaults,
} from "@/lib/services/content-clips/data";
import { clipSession, clipError } from "@/lib/services/content-clips/http";
import { runClipJobs } from "@/lib/services/content-clips/worker";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 1800;
export async function GET(request: Request) {
  try {
    const actor = await clipSession(request);
    return NextResponse.json(
      await clipData(
        new URL(request.url).searchParams.get("story") || "",
        actor,
      ),
    );
  } catch (e) {
    return clipError(e);
  }
}
export async function POST(request: Request) {
  try {
    const actor = await clipSession(request, true);
    const raw = await request.text();
    if (raw.length > 3000000)
      return NextResponse.json(
        { error: "This request is too large." },
        { status: 413 },
      );
    const body = JSON.parse(raw);
    let result;
    if (body.action === "create") {
      const clip = await createClip(
        String(body.story || ""),
        String(body.name || "Video source"),
        String(body.url || ""),
        actor,
      );
      await queueClip(clip.id, "IMPORT", actor);
      result = { id: clip.id };
    } else if (body.action === "save")
      result = await saveClip(String(body.id || ""), actor, body);
    else if (body.action === "defaults")
      result = await saveDefaults(String(body.id || ""), actor, body.draft);
    else if (body.action === "retry")
      result = {
        jobId: (
          await retryClip(
            String(body.id || ""),
            String(body.jobId || ""),
            actor,
          )
        ).id,
      };
    else if (body.action === "queue")
      result = {
        jobId: (
          await queueClip(
            String(body.id || ""),
            String(body.kind || ""),
            actor,
            {
              draft: body.draft,
              length: body.length,
              selection: body.selection,
            },
          )
        ).id,
      };
    else
      return NextResponse.json(
        { error: "Unknown Clip Studio action." },
        { status: 400 },
      );
    if (
      body.action === "create" ||
      body.action === "queue" ||
      body.action === "retry"
    )
      after(async () => {
        await runClipJobs(2);
      });
    return NextResponse.json(result);
  } catch (e) {
    return clipError(e);
  }
}
