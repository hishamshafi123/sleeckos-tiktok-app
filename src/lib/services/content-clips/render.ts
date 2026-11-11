import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { bundle } from "@remotion/bundler";
import {
  makeCancelSignal,
  renderMedia,
  selectComposition,
} from "@remotion/renderer";
import type { Draft, Word } from "../../content-clips/schema";
import { byteRange } from "./media";
let bundlePromise: Promise<string> | undefined;
export async function renderClip(
  file: string,
  output: string,
  draft: Draft,
  words: Word[],
  signal: AbortSignal,
) {
  const token = randomUUID();
  const size = (await fs.promises.stat(file)).size;
  const server = createServer((req, res) => {
    if (req.url !== `/${token}`) {
      res.writeHead(404).end();
      return;
    }
    const range = byteRange(req.headers.range || null, size);
    if (!range) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
      return;
    }
    res.writeHead(range.partial ? 206 : 200, {
      "Content-Type": "video/mp4",
      "Access-Control-Allow-Origin": "*",
      "Accept-Ranges": "bytes",
      "Content-Length": range.end - range.start + 1,
      ...(range.partial
        ? { "Content-Range": `bytes ${range.start}-${range.end}/${size}` }
        : {}),
    });
    const stream = fs.createReadStream(file, {
      start: range.start,
      end: range.end,
    });
    stream.on("error", () => res.destroy());
    res.on("close", () => stream.destroy());
    stream.pipe(res);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as { port: number };
  const { cancel, cancelSignal } = makeCancelSignal();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    bundlePromise ||= bundle({
      entryPoint: path.join(
        process.cwd(),
        "src/remotion/content-clips/index.tsx",
      ),
      publicDir: null,
    }).catch((e) => {
      bundlePromise = undefined;
      throw e;
    });
    const serveUrl = await bundlePromise;
    const inputProps = {
      src: `http://127.0.0.1:${address.port}/${token}`,
      draft,
      words,
    };
    const browserExecutable =
      process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
    const composition = await selectComposition({
      serveUrl,
      id: "news-clip",
      inputProps,
      browserExecutable,
    });
    if (signal.aborted)
      throw new Error("Export timed out. Retry with a shorter clip.");
    await renderMedia({
      composition,
      serveUrl,
      inputProps,
      outputLocation: output,
      codec: "h264",
      audioCodec: "aac",
      pixelFormat: "yuv420p",
      concurrency: 2,
      browserExecutable,
      cancelSignal,
    });
  } finally {
    signal.removeEventListener("abort", cancel);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
