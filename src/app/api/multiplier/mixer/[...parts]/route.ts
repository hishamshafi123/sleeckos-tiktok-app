import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { MixerError, record } from "@/lib/campaign-mixer/schema";
import * as data from "@/lib/services/campaign-mixer/data";
import { mixerPath, receiveUpload } from "@/lib/services/campaign-mixer/media";
import { byteRange } from "@/lib/services/content-clips/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ parts: string[] }> };
async function dispatch(request: Request, context: Context) {
  let temporary: string | undefined;
  try {
    const session = await getSession();
    if (!session)
      throw new MixerError(
        "Sign in to use Campaign Mixer.",
        "UNAUTHORIZED",
        401,
      );
    if (!(await can(session.userId, "multiplier")))
      throw new MixerError(
        "You do not have access to Multiplier.",
        "FORBIDDEN",
        403,
      );
    if (request.method !== "GET") {
      if (process.env.MIXER_ENABLED === "false") throw new MixerError("Campaign Mixer is temporarily paused for maintenance. Your saved library and batches are retained.", "MAINTENANCE", 503);
      const origin = request.headers.get("origin");
      const forwardedHost =
        request.headers.get("x-forwarded-host") ||
        request.headers.get("host") ||
        new URL(request.url).host;
      if (origin && new URL(origin).host !== forwardedHost)
        throw new MixerError(
          "Open Campaign Mixer on this site's own page before making changes.",
          "INVALID_ORIGIN",
          403,
        );
    }
    const { parts } = await context.params;
    const [resource, id, action, itemId] = parts;
    const url = new URL(request.url),
      method = request.method;
    if (
      method === "GET" &&
      resource === "batches" &&
      id &&
      action === "download"
    ) {
      const batch = await data.batchDetails(id);
      const root = path.join(
        process.cwd(),
        "public/uploads/multiplier/outputs",
      );
      const files = batch.recipes
        .filter((r) => r.output?.status === "COMPLETED" && r.output.outputRef)
        .map((r, i) => {
          const file = path.resolve(
            process.cwd(),
            "public",
            r.output!.outputRef!.replace(/^\//, ""),
          );
          if (!file.startsWith(root + path.sep) || !fs.existsSync(file))
            throw new MixerError(
              "One of this batch's completed files is missing. Download individual available files or restore the missing output.",
              "OUTPUT_MISSING",
              409,
            );
          return {
            path: file,
            name: `video_${String(i + 1).padStart(4, "0")}_${r.outputId}.mp4`,
          };
        });
      if (!files.length)
        throw new MixerError(
          "No completed videos are available to download yet.",
        );
      const python = fs.existsSync(path.join(process.cwd(), "venv/bin/python3"))
        ? path.join(process.cwd(), "venv/bin/python3")
        : "python3";
      const child = spawn(
        python,
        [path.join(process.cwd(), "scripts/mixer_zip.py")],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      child.on("error", (error) => child.stdout.destroy(error));
      child.on("exit", (code) => {
        if (code !== 0 && !child.stdout.destroyed)
          child.stdout.destroy(
            new Error("Batch download was interrupted. Please retry."),
          );
      });
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify(files));
      child.stderr.on("data", (d) =>
        console.error("[Mixer ZIP]", String(d).slice(0, 300)),
      );
      request.signal.addEventListener("abort", () => child.kill("SIGKILL"), {
        once: true,
      });
      const stream = Readable.toWeb(child.stdout) as ReadableStream;
      return new Response(stream, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="campaign-mixer-${id.slice(0, 8)}.zip"`,
          "Cache-Control": "private, no-store",
        },
      });
    }
    if (method === "GET" && resource === "export-group" && id) {
      const group = await prisma.multiplierGroup.findFirst({
        where: { id, sourceKind: "mixer" },
        include: {
          campaign: { select: { id: true, title: true } },
          variations: true,
          hooks: true,
          outputs: {
            include: {
              variation: { select: { videoRef: true } },
              hook: { select: { text: true } },
            },
          },
        },
      });
      if (!group)
        throw new MixerError(
          "This batch's output group is unavailable.",
          "NOT_FOUND",
          404,
        );
      return Response.json(group);
    }
    if (method === "GET" && (resource === "media" || resource === "caption")) {
      let relative: string | null | undefined;
      if (resource === "media") {
        const asset = await prisma.mixerAsset.findUnique({ where: { id } });
        if (!asset) throw new MixerError("Media not found.", "NOT_FOUND", 404);
        await data.workspaceAccess(asset.workspaceId);
        relative = url.searchParams.has("thumbnail")
          ? asset.thumbnailPath
          : asset.previewPath;
      } else {
        if (!/^[a-f0-9]{64}$/.test(id || ""))
          throw new MixerError("Caption not found.", "NOT_FOUND", 404);
        relative = `captions/${id}.png`;
      }
      if (!relative)
        throw new MixerError("This preview is not ready.", "NOT_FOUND", 404);
      const file = mixerPath(relative);
      const stat = await fs.promises.stat(file).catch(() => null);
      if (!stat)
        throw new MixerError(
          "This saved media file is missing. Restore the library backup.",
          "ASSET_MISSING",
          404,
        );
      const range = byteRange(request.headers.get("range"), stat.size);
      if (!range)
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${stat.size}` },
        });
      const type = relative.endsWith(".png")
        ? "image/png"
        : relative.endsWith(".jpg")
          ? "image/jpeg"
          : relative.endsWith(".m4a")
            ? "audio/mp4"
            : "video/mp4";
      return new Response(
        Readable.toWeb(
          fs.createReadStream(file, { start: range.start, end: range.end }),
        ) as ReadableStream,
        {
          status: range.partial ? 206 : 200,
          headers: {
            "Content-Type": type,
            "Content-Length": String(range.end - range.start + 1),
            "Accept-Ranges": "bytes",
            "Cache-Control": "private, max-age=60",
            "X-Content-Type-Options": "nosniff",
            ...(range.partial
              ? {
                  "Content-Range": `bytes ${range.start}-${range.end}/${stat.size}`,
                }
              : {}),
          },
        },
      );
    }
    if (resource === "workspaces" && method === "GET")
      return Response.json(
        id ? await data.workspaceDetails(id) : await data.listWorkspaces(),
      );
    if (resource === "batches" && id && method === "GET")
      return Response.json(await data.batchDetails(id));
    if (
      resource === "workspaces" &&
      id &&
      action === "upload" &&
      method === "POST"
    ) {
      await data.workspaceAccess(id);
      const kind = url.searchParams.get("kind");
      if (kind !== "clip" && kind !== "music")
        throw new MixerError("Choose clips or music for this upload.");
      const limit = (kind === "clip" ? 500 : 100) * 1024 ** 2;
      if (Number(request.headers.get("content-length")) > limit)
        throw new MixerError(
          "This file exceeds the upload limit.",
          "FILE_TOO_LARGE",
          413,
        );
      const uploaded = await receiveUpload(request.body, limit);
      temporary = uploaded.file;
      return Response.json(
        await data.addAsset(
          id,
          uploaded.file,
          kind,
          url.searchParams.get("name") || kind,
          uploaded.bytes,
        ),
      );
    }
    const raw = await request.text();
    if (raw.length > 2_000_000)
      throw new MixerError(
        "This request is too large.",
        "REQUEST_TOO_LARGE",
        413,
      );
    let body: Record<string, unknown>;
    try {
      body = record(raw ? JSON.parse(raw) : {});
    } catch {
      throw new MixerError("Invalid request data.");
    }
    if (resource === "workspaces") {
      if (!id && method === "POST")
        return Response.json(
          await data.createWorkspace(
            String(body.campaignId || ""),
            session.userId,
          ),
        );
      if (id && !action && method === "PATCH")
        return Response.json(await data.saveWorkspace(id, body));
      if (id && action === "assets" && itemId && method === "PATCH") {
        await data.editAsset(id, itemId, body);
        return Response.json({ saved: true });
      }
      if (id && action === "texts" && !itemId && method === "POST")
        return Response.json(await data.addTexts(id, body.texts));
      if (id && action === "texts" && itemId && method === "PATCH") {
        await data.editText(id, itemId, body);
        return Response.json({ saved: true });
      }
      if (id && action === "presets" && method === "POST")
        return Response.json(await data.savePreset(id, body));
      if (id && action === "plan" && method === "POST")
        return Response.json((await data.preparePlan(id, body.selection)).plan);
      if (id && action === "confirm" && method === "POST")
        return Response.json(await data.confirmBatch(id, body, session.userId));
      if (id && action === "sample" && method === "POST")
        return Response.json(await data.renderSample(id, body));
    }
    if (
      resource === "batches" &&
      id &&
      action === "control" &&
      method === "POST"
    ) {
      await data.controlBatch(id, body.action);
      return Response.json({ saved: true });
    }
    throw new MixerError("This Mixer action was not found.", "NOT_FOUND", 404);
  } catch (e) {
    if (e instanceof MixerError)
      return Response.json(
        { error: e.message, code: e.code },
        { status: e.status },
      );
    console.error("[Campaign Mixer] Request failed:", e);
    return Response.json(
      {
        error:
          "Campaign Mixer could not complete this action. Your saved data is retained. Retry, or check the server logs if it continues.",
        code: "INTERNAL_ERROR",
      },
      { status: 500 },
    );
  } finally {
    if (temporary) await fs.promises.unlink(temporary).catch(() => {});
  }
}
export const GET = dispatch;
export const POST = dispatch;
export const PATCH = dispatch;
