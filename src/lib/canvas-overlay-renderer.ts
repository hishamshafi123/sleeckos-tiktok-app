/**
 * Browser-Based Overlay Renderer (Puppeteer)
 * 
 * Uses headless Chromium to render the EXACT same HTML/CSS as the
 * Live Studio Preview. This guarantees pixel-perfect parity between
 * what the admin sees in the preview and what appears in the final video.
 * 
 * Flow:
 * 1. Generate self-contained HTML with inline CSS (same as Live Studio)
 * 2. Launch headless Chromium via puppeteer-core
 * 3. For each frame: update current time → screenshot (transparent)
 * 4. Pipe RGBA frames to FFmpeg → WebM VP8 with alpha channel
 */

import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Word {
  word: string;
  start: number;
  end: number;
}

interface TemplateConfig {
  fontFamily: string;
  fontSize: number;
  activeColor: string;
  strokeWidth: number;
  strokeColor: string;
  positionY: number;
  colorFilter: string;
  vignette: string;
  particleFx: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const WIDTH = 720;
const HEIGHT = 1280;
const FPS = 25;

const MULTI_COLORS = ["#FFFF00", "#00FF00", "#00FFFF", "#FF00FF", "#FF5F00", "#FF007F"];

// ─── Font Mapping ───────────────────────────────────────────────────────────
// Maps config fontFamily values to CSS font-family + the TTF filename

const FONT_CSS_MAP: Record<string, { css: string; file: string }> = {
  "Montserrat-Black": { css: "'Montserrat', sans-serif", file: "Montserrat-Bold.ttf" },
  "Outfit-Bold":      { css: "'Outfit', sans-serif",     file: "Outfit-Bold.ttf" },
  "Anton":            { css: "'Anton', sans-serif",      file: "Anton.ttf" },
  "Inter-Bold":       { css: "'Inter', sans-serif",      file: "Inter-Bold.ttf" },
  "Caveat-Bold":      { css: "'Caveat', cursive",        file: "Caveat-Bold.ttf" },
  "Oswald-Bold":      { css: "'Oswald', sans-serif",     file: "Oswald-Bold.ttf" },
  "PlayfairDisplay-Bold": { css: "'Playfair Display', serif", file: "PlayfairDisplay-Bold.ttf" },
  "GreatVibes-Regular":   { css: "'Great Vibes', cursive",    file: "GreatVibes-Regular.ttf" },
  "Lora-Bold":        { css: "'Lora', serif",            file: "Lora-Bold.ttf" },
};

// ─── Word Chunking (same logic as Live Studio Preview) ──────────────────────

function chunkWords(words: Word[], maxPerChunk = 4): Word[][] {
  const chunks: Word[][] = [];
  let current: Word[] = [];
  let lastEnd = 0;

  for (const w of words) {
    if (current.length >= maxPerChunk || (current.length > 0 && w.start - lastEnd > 1.5)) {
      chunks.push(current);
      current = [];
    }
    current.push(w);
    lastEnd = w.end;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

// ─── HTML Template Generator ────────────────────────────────────────────────
// This generates a SELF-CONTAINED HTML page with the EXACT same CSS
// as the Live Studio Preview in genres/page.tsx

function generateOverlayHTML(
  words: Word[],
  config: TemplateConfig,
  fontsDir: string,
): string {
  const chunks = chunkWords(words);
  const fontEntry = FONT_CSS_MAP[config.fontFamily] || FONT_CSS_MAP["Montserrat-Black"];
  const fontFilePath = path.join(fontsDir, fontEntry.file);
  
  // Also load Montserrat as fallback
  const montserratPath = path.join(fontsDir, "Montserrat-Bold.ttf");

  // Generate vignette CSS
  let vignetteCSS = "";
  if (config.vignette === "bottom_fade") {
    vignetteCSS = `background: linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.20) 50%, transparent 100%);`;
  } else if (config.vignette === "radial_vignette") {
    vignetteCSS = `background: radial-gradient(circle, transparent 40%, rgba(0,0,0,0.65) 95%);`;
  } else if (config.vignette === "sunset_glow") {
    vignetteCSS = `background: radial-gradient(circle at top left, rgba(255,140,0,0.65) 0%, rgba(255,69,0,0) 60%);`;
  } else if (config.vignette === "emerald_fade") {
    vignetteCSS = `background: radial-gradient(circle, transparent 40%, rgba(5,28,15,0.65) 95%);`;
  }

  // Generate particle HTML (CSS-animated, matching Live Studio Preview)
  let particleHTML = "";
  if (config.particleFx === "gold_dust.mp4") {
    const particles = [
      { w: 4, bg: "rgba(255,175,50,0.50)", blur: "0.3px", top: 95, left: 10, delay: "0s", dur: "5.5s" },
      { w: 8, bg: "rgba(255,220,100,0.40)", blur: "0.8px", top: 90, left: 45, delay: "1.2s", dur: "4.8s" },
      { w: 4, bg: "rgba(255,255,255,0.60)", blur: "0",     top: 98, left: 75, delay: "2.5s", dur: "6.5s" },
      { w: 6, bg: "rgba(255,190,50,0.35)",  blur: "1.2px", top: 92, left: 60, delay: "0.5s", dur: "7.2s" },
      { w: 6, bg: "rgba(255,240,100,0.50)", blur: "0.3px", top: 94, left: 30, delay: "1.8s", dur: "5.8s" },
      { w: 8, bg: "rgba(255,175,50,0.30)",  blur: "0.5px", top: 96, left: 85, delay: "3.2s", dur: "6s" },
      { w: 6, bg: "rgba(255,210,50,0.40)",  blur: "0",     top: 91, left: 20, delay: "4.1s", dur: "5.2s" },
      { w: 4, bg: "rgba(255,255,255,0.50)", blur: "0.4px", top: 97, left: 55, delay: "0.8s", dur: "7s" },
      { w: 10, bg: "rgba(255,200,100,0.25)", blur: "1.5px", top: 93, left: 70, delay: "2.9s", dur: "8s" },
      { w: 4, bg: "rgba(255,200,50,0.60)",  blur: "0",     top: 95, left: 40, delay: "5s", dur: "6.2s" },
    ];
    particleHTML = particles.map(p =>
      `<div style="position:absolute;width:${p.w}px;height:${p.w}px;background:${p.bg};border-radius:50%;filter:blur(${p.blur});top:${p.top}%;left:${p.left}%;animation:floatDust ${p.dur} ease-in-out infinite;animation-delay:${p.delay}"></div>`
    ).join("\n");
  } else if (config.particleFx === "bokeh.mp4") {
    const bokeh = [
      { w: 40, bg: "rgba(255,170,30,0.08)", blur: "10px", top: 90, left: 20, delay: "0s", dur: "8s" },
      { w: 60, bg: "rgba(255,200,50,0.06)", blur: "15px", top: 80, left: 60, delay: "2s", dur: "10s" },
      { w: 30, bg: "rgba(255,150,20,0.10)", blur: "8px",  top: 95, left: 40, delay: "4s", dur: "7s" },
      { w: 50, bg: "rgba(255,180,40,0.07)", blur: "12px", top: 85, left: 80, delay: "1s", dur: "9s" },
    ];
    particleHTML = bokeh.map(p =>
      `<div style="position:absolute;width:${p.w}px;height:${p.w}px;background:${p.bg};border-radius:50%;filter:blur(${p.blur});top:${p.top}%;left:${p.left}%;animation:floatDust ${p.dur} ease-in-out infinite;animation-delay:${p.delay}"></div>`
    ).join("\n");
  } else if (config.particleFx === "fireflies.mp4") {
    const flies = [
      { w: 8, bg: "rgba(132,204,22,0.8)", glow: "0 0 8px #84cc16", top: 95, left: 20, delay: "0s", dur: "6.8s" },
      { w: 6, bg: "rgba(253,224,71,0.8)", glow: "0 0 6px #fde047", top: 92, left: 65, delay: "1.5s", dur: "5.8s" },
      { w: 8, bg: "rgba(190,242,100,0.8)", glow: "0 0 8px #bef264", top: 96, left: 45, delay: "3s", dur: "7.5s" },
      { w: 4, bg: "rgba(254,240,138,0.8)", glow: "0 0 4px #fef08a", top: 90, left: 80, delay: "0.8s", dur: "8.5s" },
      { w: 10, bg: "rgba(132,204,22,0.8)", glow: "0 0 9px #84cc16", top: 94, left: 10, delay: "2.2s", dur: "7.2s" },
      { w: 6, bg: "rgba(190,242,100,0.8)", glow: "0 0 6px #bef264", top: 97, left: 30, delay: "4.1s", dur: "6.2s" },
      { w: 8, bg: "rgba(253,224,71,0.8)", glow: "0 0 8px #fde047", top: 93, left: 55, delay: "5.3s", dur: "8s" },
      { w: 6, bg: "rgba(132,204,22,0.8)", glow: "0 0 6px #84cc16", top: 98, left: 72, delay: "1.9s", dur: "6.5s" },
    ];
    particleHTML = flies.map(p =>
      `<div style="position:absolute;width:${p.w}px;height:${p.w}px;background:${p.bg};border-radius:50%;box-shadow:${p.glow};top:${p.top}%;left:${p.left}%;animation:floatFireflies ${p.dur} ease-in-out infinite;animation-delay:${p.delay}"></div>`
    ).join("\n");
  } else if (config.particleFx === "snow.mp4") {
    const snow = [
      { w: 8,  bg: "rgba(255,255,255,0.9)", top: -10, left: 15, delay: "0s", dur: "4.8s" },
      { w: 6,  bg: "rgba(241,245,249,0.8)", top: -10, left: 45, delay: "1.2s", dur: "4.2s" },
      { w: 10, bg: "rgba(255,255,255,0.85)", top: -10, left: 70, delay: "2.5s", dur: "5.8s" },
      { w: 6,  bg: "rgba(255,255,255,0.7)", top: -10, left: 30, delay: "0.5s", dur: "5.2s" },
      { w: 10, bg: "rgba(226,232,240,0.9)", top: -10, left: 85, delay: "3.2s", dur: "4.5s" },
      { w: 6,  bg: "rgba(255,255,255,0.8)", top: -10, left: 5,  delay: "1.8s", dur: "5s" },
      { w: 10, bg: "rgba(255,255,255,0.9)", top: -10, left: 60, delay: "0.9s", dur: "4.6s" },
      { w: 4,  bg: "rgba(241,245,249,1)",   top: -10, left: 38, delay: "2.9s", dur: "3.8s" },
      { w: 10, bg: "rgba(255,255,255,0.95)", top: -10, left: 80, delay: "4.1s", dur: "5.5s" },
      { w: 6,  bg: "rgba(255,255,255,0.75)", top: -10, left: 52, delay: "1.5s", dur: "4.9s" },
      { w: 8,  bg: "rgba(241,245,249,1)",   top: -10, left: 22, delay: "3.6s", dur: "5.1s" },
      { w: 6,  bg: "rgba(255,255,255,1)",   top: -10, left: 95, delay: "0.3s", dur: "4.3s" },
    ];
    particleHTML = snow.map(p =>
      `<div style="position:absolute;width:${p.w}px;height:${p.w}px;background:${p.bg};border-radius:50%;top:${p.top}px;left:${p.left}%;animation:fallSnow ${p.dur} linear infinite;animation-delay:${p.delay}"></div>`
    ).join("\n");
  }

  // Serialize chunks to JSON for the page script
  const chunksJSON = JSON.stringify(chunks);
  const activeColor = config.activeColor;
  const multiColorsJSON = JSON.stringify(MULTI_COLORS);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @font-face {
    font-family: 'PrimaryFont';
    src: url('file://${fontFilePath}');
    font-weight: 900;
    font-style: normal;
  }
  @font-face {
    font-family: 'Montserrat';
    src: url('file://${montserratPath}');
    font-weight: 900;
    font-style: normal;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }
  
  body {
    width: ${WIDTH}px;
    height: ${HEIGHT}px;
    overflow: hidden;
    background: transparent;
  }

  #container {
    position: relative;
    width: ${WIDTH}px;
    height: ${HEIGHT}px;
    overflow: hidden;
  }

  /* Vignette layer */
  #vignette {
    position: absolute;
    inset: 0;
    ${vignetteCSS}
    pointer-events: none;
    z-index: 1;
  }

  /* Particles layer */
  #particles {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    z-index: 2;
  }

  /* Caption layer — EXACT MATCH with Live Studio Preview */
  #captions {
    position: absolute;
    left: 0;
    right: 0;
    padding: 0 12px;
    text-align: center;
    transform: translateY(-50%);
    top: ${config.positionY * 100}%;
    font-family: 'PrimaryFont', ${fontEntry.css};
    font-size: ${config.fontSize}px;
    line-height: 1.25;
    z-index: 10;
    user-select: none;
    pointer-events: none;
  }

  #captions .words {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 4px 4px;
  }

  #captions .word {
    display: inline-block;
    color: #ffffff;
    -webkit-text-stroke: ${config.strokeWidth}px ${config.strokeColor};
    font-weight: 800;
    transition: all 0.08s ease-out;
  }

  #captions .word.active {
    font-weight: 900;
    letter-spacing: -0.025em;
    transform: scale(1.12);
  }

  /* Particle animations — matching Live Studio Preview keyframes */
  @keyframes floatDust {
    0% { transform: translateY(0) translateX(0); opacity: 0; }
    10% { opacity: 1; }
    90% { opacity: 1; }
    100% { transform: translateY(-${HEIGHT}px) translateX(30px); opacity: 0; }
  }

  @keyframes floatFireflies {
    0%, 100% { transform: translate(0, 0); opacity: 0.3; }
    25% { transform: translate(15px, -30px); opacity: 1; }
    50% { transform: translate(-10px, -60px); opacity: 0.6; }
    75% { transform: translate(20px, -20px); opacity: 1; }
  }

  @keyframes fallSnow {
    0% { transform: translateY(0) translateX(0); opacity: 1; }
    100% { transform: translateY(${HEIGHT + 20}px) translateX(30px); opacity: 0.7; }
  }
</style>
</head>
<body>
  <div id="container">
    <div id="vignette"></div>
    <div id="particles">
      ${particleHTML}
    </div>
    <div id="captions">
      <div class="words" id="wordsContainer"></div>
    </div>
  </div>

  <script>
    const chunks = ${chunksJSON};
    const activeColorConfig = "${activeColor}";
    const multiColors = ${multiColorsJSON};
    const strokeWidth = ${config.strokeWidth};
    const strokeColor = "${config.strokeColor}";

    function getWordColor(idx, isActive) {
      if (!isActive) return "#ffffff";
      if (activeColorConfig === "multi") return multiColors[idx % multiColors.length];
      return activeColorConfig;
    }

    // Exposed to Puppeteer — sets the current time and re-renders captions
    window.setTime = function(t) {
      const container = document.getElementById("wordsContainer");
      
      // Find the active chunk
      let currentChunk = null;
      for (const chunk of chunks) {
        const chunkStart = chunk[0].start;
        const chunkEnd = chunk[chunk.length - 1].end;
        if (t >= chunkStart && t <= chunkEnd + 0.3) {
          currentChunk = chunk;
          break;
        }
      }

      if (!currentChunk) {
        container.innerHTML = "";
        return;
      }

      // Build word spans
      let html = "";
      for (let i = 0; i < currentChunk.length; i++) {
        const w = currentChunk[i];
        const isActive = (t >= w.start && t <= w.end);
        const color = getWordColor(i, isActive);
        
        const textShadow = isActive 
          ? "text-shadow: 0 0 8px " + color + "cc, 0 0 16px " + color + "50;"
          : "text-shadow: none;";
        const stroke = "-webkit-text-stroke: " + strokeWidth + "px " + strokeColor + ";";
        
        html += '<span class="word ' + (isActive ? 'active' : '') + '" style="color:' + color + ';' + textShadow + stroke + '">' + w.word + '</span>';
      }
      container.innerHTML = html;
    };

    // Initialize with t=0
    window.setTime(0);
  </script>
</body>
</html>`;
}

// ─── Chromium Path Detection ────────────────────────────────────────────────

function findChromiumPath(): string {
  // 1. Environment variable (set in Dockerfile)
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  
  // 2. Common Docker/Linux paths
  const candidates = [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ];
  
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  
  // 3. macOS (for local development)
  const macPath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (fs.existsSync(macPath)) return macPath;
  
  throw new Error("[Browser Renderer] Could not find Chromium/Chrome executable. Set PUPPETEER_EXECUTABLE_PATH.");
}

// ─── Main Overlay Renderer ──────────────────────────────────────────────────

export async function renderCanvasOverlay(
  words: Word[],
  config: TemplateConfig,
  duration: number,
  outputPath: string,
): Promise<void> {
  const fontsDir = path.join(process.cwd(), "public", "fonts");
  const totalFrames = Math.ceil(duration * FPS);

  console.log(`[Browser Renderer] Rendering ${totalFrames} frames at ${FPS}fps (${duration.toFixed(1)}s)`);
  console.log(`[Browser Renderer] Config: font=${config.fontFamily}, size=${config.fontSize}, active=${config.activeColor}`);
  console.log(`[Browser Renderer] Effects: vignette=${config.vignette}, particles=${config.particleFx}`);
  console.log(`[Browser Renderer] Output: ${outputPath}`);

  // Ensure output directory exists
  const outDir = path.dirname(outputPath);
  fs.mkdirSync(outDir, { recursive: true });

  // Atomic write: render to .tmp, rename on success
  const tmpPath = outputPath + ".tmp";
  try { fs.unlinkSync(outputPath + ".ready"); } catch {}
  try { fs.unlinkSync(tmpPath); } catch {}
  try { fs.unlinkSync(outputPath); } catch {}

  // Generate the HTML
  const html = generateOverlayHTML(words, config, fontsDir);
  const htmlPath = path.join("/tmp", `overlay_${Date.now()}.html`);
  fs.writeFileSync(htmlPath, html, "utf-8");

  // Launch headless Chromium
  const puppeteer = await import("puppeteer-core");
  const chromiumPath = findChromiumPath();
  console.log(`[Browser Renderer] Using Chromium: ${chromiumPath}`);

  const browser = await puppeteer.default.launch({
    executablePath: chromiumPath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-web-security",
      "--allow-file-access-from-files",
      `--window-size=${WIDTH},${HEIGHT}`,
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
    
    // Load the HTML file (file:// protocol for font loading)
    await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle0", timeout: 15000 });
    
    // Wait for fonts to load
    await page.evaluate(() => document.fonts.ready);
    console.log(`[Browser Renderer] Page loaded, fonts ready. Starting frame capture...`);

    // Spawn FFmpeg to receive PNG frames and encode to WebM VP8 with alpha
    const ffmpegArgs = [
      "-y",
      "-f", "image2pipe",
      "-framerate", String(FPS),
      "-i", "-",
      "-c:v", "libvpx",
      "-pix_fmt", "yuva420p",
      "-auto-alt-ref", "0",
      "-quality", "realtime",
      "-speed", "6",
      "-b:v", "2M",
      "-t", String(duration),
      tmpPath,
    ];

    const ffmpeg = spawn("ffmpeg", ffmpegArgs, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let ffmpegStderr = "";
    ffmpeg.stderr.on("data", (data: Buffer) => {
      ffmpegStderr += data.toString();
    });

    // Capture frames
    for (let frame = 0; frame < totalFrames; frame++) {
      const t = frame / FPS;

      // Update the page's current time (triggers re-render of captions)
      await page.evaluate((time: number) => {
        (window as any).setTime(time);
      }, t);

      // Screenshot with transparent background → PNG buffer
      const screenshot = await page.screenshot({
        type: "png",
        omitBackground: true,
        clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
      });

      // Write PNG frame to FFmpeg stdin (image2pipe decoder handles PNG)
      const canWrite = ffmpeg.stdin.write(screenshot);
      if (!canWrite) {
        await new Promise<void>((resolve) => ffmpeg.stdin.once("drain", resolve));
      }

      // Progress logging every 2 seconds
      if (frame % (FPS * 2) === 0) {
        console.log(`[Browser Renderer] Frame ${frame}/${totalFrames} (${((frame / totalFrames) * 100).toFixed(0)}%)`);
      }
    }

    // Close FFmpeg stdin and wait for completion
    ffmpeg.stdin.end();

    await new Promise<void>((resolve, reject) => {
      ffmpeg.on("close", (code) => {
        if (code === 0 && fs.existsSync(tmpPath)) {
          const stat = fs.statSync(tmpPath);
          if (stat.size < 1024) {
            console.error(`[Browser Renderer] Output file too small (${stat.size} bytes), discarding`);
            try { fs.unlinkSync(tmpPath); } catch {}
            reject(new Error("Browser overlay output too small — likely corrupt"));
            return;
          }
          // Atomic rename
          fs.renameSync(tmpPath, outputPath);
          fs.writeFileSync(outputPath + ".ready", new Date().toISOString(), "utf-8");
          console.log(`[Browser Renderer] Complete! Output: ${outputPath} (${(stat.size / 1024).toFixed(0)}KB)`);
          resolve();
        } else {
          console.error(`[Browser Renderer] FFmpeg failed with code ${code}:`, ffmpegStderr.slice(-1000));
          try { fs.unlinkSync(tmpPath); } catch {}
          reject(new Error(`FFmpeg encoding failed with code ${code}`));
        }
      });

      ffmpeg.on("error", (err) => {
        console.error("[Browser Renderer] FFmpeg spawn error:", err);
        try { fs.unlinkSync(tmpPath); } catch {}
        reject(err);
      });
    });

  } finally {
    await browser.close();
    // Cleanup temp HTML file
    try { fs.unlinkSync(htmlPath); } catch {}
  }
}

// ─── Static Preview Frame ───────────────────────────────────────────────────

export async function renderPreviewFrame(
  words: Word[],
  config: TemplateConfig,
  outputPngPath: string,
): Promise<void> {
  const fontsDir = path.join(process.cwd(), "public", "fonts");

  console.log(`[Browser Renderer] Generating preview frame: ${outputPngPath}`);

  const html = generateOverlayHTML(words, config, fontsDir);
  const htmlPath = path.join("/tmp", `preview_${Date.now()}.html`);
  fs.writeFileSync(htmlPath, html, "utf-8");

  const puppeteer = await import("puppeteer-core");
  const chromiumPath = findChromiumPath();

  const browser = await puppeteer.default.launch({
    executablePath: chromiumPath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-web-security",
      "--allow-file-access-from-files",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
    await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle0", timeout: 15000 });
    await page.evaluate(() => document.fonts.ready);

    // Set time to first word for preview
    const chunks = chunkWords(words);
    if (chunks.length > 0) {
      const firstWordStart = chunks[0][0].start;
      await page.evaluate((t: number) => (window as any).setTime(t), firstWordStart);
    }

    // Add dark background for the preview image (since there's no video behind it)
    await page.evaluate(() => {
      document.body.style.background = "rgba(0,0,0,0.85)";
    });

    const outDir = path.dirname(outputPngPath);
    fs.mkdirSync(outDir, { recursive: true });

    const screenshot = await page.screenshot({
      type: "png",
      path: outputPngPath,
      clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
    });

    console.log(`[Browser Renderer] Preview frame saved: ${outputPngPath}`);
  } finally {
    await browser.close();
    try { fs.unlinkSync(htmlPath); } catch {}
  }
}
