import assert from "node:assert/strict";
import {
  checkYouTubeInfo,
  rapidYouTubeRequest,
  selectYouTubeFormats,
} from "../src/lib/services/content-clips/youtube-rapidapi";

const url = "https://rr1.googlevideo.com/videoplayback?signature=fixture";
const v = {
  url,
  format_id: "137",
  vcodec: "avc1.640028",
  acodec: "none",
  height: 1080,
  filesize: 1000,
  protocol: "https",
};
const a = {
  url,
  format_id: "140",
  vcodec: "none",
  acodec: "mp4a.40.2",
  filesize: 100,
  abr: 128,
  protocol: "https",
};
const combined = { ...v, height: 360, acodec: "mp4a.40.2" };
async function main() {
  checkYouTubeInfo({ duration: 1200 });
  checkYouTubeInfo({ duration: "PT1M20S" });
  for (const info of [
    { duration: 1201 },
    { duration: 20, is_live: true },
    { duration: 20, is_upcoming: true },
    { duration: 20, is_private: true },
    {},
  ])
    assert.throws(() => checkYouTubeInfo(info));
  const chosen = selectYouTubeFormats([combined, v, a, { ...v, height: 2160 }]);
  assert.equal(chosen.video.height, 1080);
  assert.ok(chosen.audio?.aac, "higher-quality video keeps an audio stream");
  assert.equal(selectYouTubeFormats([combined]).audio, undefined);
  assert.equal(
    selectYouTubeFormats([
      {
        url,
        hasVideo: true,
        hasAudio: true,
        videoCodec: "avc1",
        height: 720,
        contentLength: "1000",
      },
    ]).video.height,
    720,
    "documented response supported",
  );
  assert.equal(
    selectYouTubeFormats([
      { ...v, height: 720, filesize: 524288000 },
      a,
      combined,
    ]).video.height,
    360,
    "combined byte budget enforced",
  );
  for (const formats of [
    [v],
    [{ ...combined, url: "https://127.0.0.1/a" }],
    [{ ...combined, url: "https://googlevideo.com.evil.invalid/a" }],
    [{ ...combined, protocol: "m3u8_native" }],
    [{ ...combined, has_drm: true }],
    [{ ...combined, height: 2160 }],
    [{ ...combined, contentLength: 600000000 }],
  ])
    assert.throws(() => selectYouTubeFormats(formats));
  const previous = process.env.RAPIDAPI_YOUTUBE_KEY;
  process.env.RAPIDAPI_YOUTUBE_KEY = "test-secret-never-print";
  try {
    let count = 0;
    const mock: typeof fetch = async (input, init) => {
      count++;
      assert.equal(
        String(input),
        "https://cloud-api-hub-youtube-downloader.p.rapidapi.com/info?id=jNQXAC9IVRw",
      );
      assert.equal(
        new Headers(init?.headers).get("X-RapidAPI-Key"),
        "test-secret-never-print",
      );
      assert.equal(init?.redirect, "error");
      return Response.json({ duration: 19 });
    };
    assert.deepEqual(
      await rapidYouTubeRequest(
        "info",
        "jNQXAC9IVRw",
        new AbortController().signal,
        mock,
      ),
      { duration: 19 },
    );
    assert.equal(count, 1);
    let burstCalls = 0;
    const retried = await rapidYouTubeRequest(
      "info",
      "jNQXAC9IVRw",
      new AbortController().signal,
      async () => {
        burstCalls++;
        return burstCalls === 1
          ? new Response(null, { status: 429 })
          : Response.json({ duration: 19 });
      },
    );
    assert.deepEqual(retried, { duration: 19 });
    assert.equal(burstCalls, 2, "retry a brief rate limit once");
    for (const [status, match] of [
      [403, /subscription/],
      [429, /quota/],
      [404, /find/],
      [502, /unavailable/],
    ] as const) {
      await assert.rejects(
        rapidYouTubeRequest(
          "download",
          "jNQXAC9IVRw",
          new AbortController().signal,
          async () => new Response("secret upstream details", { status }),
        ),
        match,
      );
    }
    await assert.rejects(
      rapidYouTubeRequest(
        "download",
        "jNQXAC9IVRw",
        new AbortController().signal,
        async () => new Response("not JSON"),
      ),
      /unreadable/,
    );
    await assert.rejects(
      rapidYouTubeRequest(
        "download",
        "jNQXAC9IVRw",
        new AbortController().signal,
        async () => new Response("x".repeat(2 * 1024 * 1024 + 1)),
      ),
      /too much metadata/,
    );
    await assert.rejects(
      rapidYouTubeRequest(
        "download",
        "jNQXAC9IVRw",
        new AbortController().signal,
        async () => {
          throw new Error("secret upstream details");
        },
      ),
      /Could not reach RapidAPI/,
    );
    delete process.env.RAPIDAPI_YOUTUBE_KEY;
    await assert.rejects(
      rapidYouTubeRequest(
        "download",
        "jNQXAC9IVRw",
        new AbortController().signal,
        mock,
      ),
      /configure RAPIDAPI_YOUTUBE_KEY/,
    );
  } finally {
    if (previous === undefined) delete process.env.RAPIDAPI_YOUTUBE_KEY;
    else process.env.RAPIDAPI_YOUTUBE_KEY = previous;
  }
  console.log(
    "PASS: both response formats, video/audio selection, resolution and byte limits, live/private restrictions, URL validation, authentication, quota and sanitized provider errors",
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
