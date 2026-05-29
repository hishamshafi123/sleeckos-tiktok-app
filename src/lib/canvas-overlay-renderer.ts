/**
 * Canvas-Based Overlay Renderer
 * 
 * Generates a transparent video overlay (WebM VP8 with alpha) using
 * @napi-rs/canvas. The Canvas API uses the SAME rendering math as CSS:
 * - ctx.shadowBlur = CSS text-shadow
 * - ctx.createLinearGradient = CSS linear-gradient
 * - ctx.globalAlpha = CSS opacity
 * - ctx.fillText with registerFont = CSS font-family
 * 
 * This ensures the rendered overlay matches the Live Studio Preview exactly.
 */

import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";

// Use 'any' for canvas context type — @napi-rs/canvas's SKRSContext2D
// has the same API as CanvasRenderingContext2D but TypeScript sees them as different types
type Ctx = any;

// ─── Types ───────────────────────────────────────────────────────────────────

interface Word {
  word: string;
  start: number;
  end: number;
}

interface TemplateConfig {
  fontFamily: string;
  fontSize: number;
  activeColor: string; // hex or "multi"
  strokeWidth: number;
  strokeColor: string;
  positionY: number; // 0.0 to 1.0
  colorFilter: string;
  vignette: string;
  particleFx: string;
}

interface Particle {
  x: number;
  y: number;
  vy: number;
  vx: number;
  vxAmp: number;
  vxFreq: number;
  vxPhase: number;
  radius: number;
  blur: number;
  alpha: number;
  color: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const WIDTH = 720;
const HEIGHT = 1280;
const FPS = 25;

const MULTI_COLORS = ["#FFFF00", "#00FF00", "#00FFFF", "#FF00FF", "#FF5F00", "#FF007F"];

// ─── Font Registration ──────────────────────────────────────────────────────

const FONT_MAP: Record<string, string> = {
  "Montserrat-Black": "Montserrat",
  "Outfit-Bold": "Outfit",
  "Anton": "Anton",
  "Inter-Bold": "Inter",
  "Caveat-Bold": "Caveat",
  "Oswald-Bold": "Oswald",
  "PlayfairDisplay-Bold": "PlayfairDisplay",
  "GreatVibes-Regular": "GreatVibes",
  "Lora-Bold": "Lora",
};

let fontsRegistered = false;

function registerFonts() {
  if (fontsRegistered) return;
  
  const fontsDir = path.join(process.cwd(), "public", "fonts");
  if (!fs.existsSync(fontsDir)) {
    console.warn("[Canvas Renderer] Fonts directory not found:", fontsDir);
    return;
  }

  const files = fs.readdirSync(fontsDir).filter(f => f.endsWith(".ttf"));
  for (const file of files) {
    const fontPath = path.join(fontsDir, file);
    const familyName = file.replace(/\.ttf$/, "").replace(/-/g, "");
    try {
      GlobalFonts.registerFromPath(fontPath, familyName);
    } catch (e) {
      // Ignore duplicate registrations
    }
  }
  fontsRegistered = true;
  console.log(`[Canvas Renderer] Registered ${files.length} fonts`);
}

// ─── Word Chunking ──────────────────────────────────────────────────────────

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

// ─── Particle System ────────────────────────────────────────────────────────

function initParticles(type: string): Particle[] {
  const particles: Particle[] = [];
  const rand = (min: number, max: number) => Math.random() * (max - min) + min;

  if (type === "gold_dust.mp4") {
    for (let i = 0; i < 85; i++) {
      particles.push({
        x: rand(0, WIDTH), y: rand(0, HEIGHT),
        vy: -rand(2.0, 5.0), vx: 0,
        vxAmp: rand(0.5, 1.5), vxFreq: rand(0.02, 0.08), vxPhase: rand(0, Math.PI * 2),
        radius: rand(1, 3), blur: rand(0, 1),
        alpha: rand(0.3, 0.7),
        color: `rgba(255, 190, 50, 1)`,
      });
    }
  } else if (type === "bokeh.mp4") {
    for (let i = 0; i < 15; i++) {
      particles.push({
        x: rand(-50, WIDTH + 50), y: rand(0, HEIGHT),
        vy: -rand(0.8, 2.2), vx: 0,
        vxAmp: rand(0.2, 0.8), vxFreq: rand(0.005, 0.02), vxPhase: rand(0, Math.PI * 2),
        radius: rand(20, 45), blur: rand(8, 15),
        alpha: rand(0.06, 0.12), // Very subtle, matching CSS opacity 0.08-0.12
        color: `rgba(255, 170, 30, 1)`,
      });
    }
  } else if (type === "fireflies.mp4") {
    for (let i = 0; i < 25; i++) {
      particles.push({
        x: rand(0, WIDTH), y: rand(0, HEIGHT),
        vy: -rand(0.5, 2.0), vx: rand(-2, 2),
        vxAmp: 0, vxFreq: 0, vxPhase: 0,
        radius: rand(2, 4), blur: 3,
        alpha: rand(0.4, 0.8),
        color: `rgba(100, 230, 30, 1)`,
      });
    }
  } else if (type === "snow.mp4") {
    for (let i = 0; i < 95; i++) {
      particles.push({
        x: rand(0, WIDTH), y: rand(-50, HEIGHT),
        vy: rand(3.0, 6.0), vx: 0,
        vxAmp: rand(1.0, 3.5), vxFreq: rand(0.03, 0.09), vxPhase: rand(0, Math.PI * 2),
        radius: rand(1, 4), blur: rand(0, 1),
        alpha: rand(0.4, 0.9),
        color: `rgba(240, 245, 255, 1)`,
      });
    }
  }

  return particles;
}

function updateParticles(particles: Particle[], type: string, frameIdx: number) {
  for (const p of particles) {
    if (type === "gold_dust.mp4") {
      p.y += p.vy;
      p.x += p.vxAmp * Math.sin(frameIdx * p.vxFreq + p.vxPhase);
      if (p.y < -20) { p.y = HEIGHT + 10; p.x = Math.random() * WIDTH; }
    } else if (type === "bokeh.mp4") {
      p.y += p.vy;
      p.x += p.vxAmp * Math.sin(frameIdx * p.vxFreq + p.vxPhase);
      if (p.y < -100) { p.y = HEIGHT + 50; p.x = Math.random() * (WIDTH + 100) - 50; }
    } else if (type === "fireflies.mp4") {
      p.vx += (Math.random() - 0.5) * 0.8;
      p.vy += (Math.random() - 0.5) * 0.8;
      p.vx = Math.max(-2.5, Math.min(2.5, p.vx));
      p.vy = Math.max(-2.5, Math.min(2.5, p.vy));
      p.vy -= 0.05;
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < -10) p.x = WIDTH + 5;
      else if (p.x > WIDTH + 10) p.x = -5;
      if (p.y < -10) p.y = HEIGHT + 5;
      else if (p.y > HEIGHT + 10) p.y = -5;
    } else if (type === "snow.mp4") {
      p.y += p.vy;
      p.x += p.vxAmp * Math.sin(frameIdx * p.vxFreq + p.vxPhase);
      if (p.y > HEIGHT + 10) { p.y = -20; p.x = Math.random() * WIDTH; }
    }
  }
}

// ─── Draw Functions ─────────────────────────────────────────────────────────

function drawParticles(
  ctx: Ctx,
  particles: Particle[],
  type: string
) {
  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha = p.alpha;
    
    if (type === "fireflies.mp4") {
      // Glow effect
      ctx.shadowBlur = 8;
      ctx.shadowColor = "rgba(132, 204, 22, 0.8)";
      ctx.fillStyle = "rgba(180, 255, 50, 1)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    } else {
      if (p.blur > 0) {
        ctx.shadowBlur = p.blur;
        ctx.shadowColor = p.color;
      }
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    
    ctx.restore();
  }
}

function drawVignette(ctx: Ctx, type: string) {
  if (type === "bottom_fade") {
    // CSS: bg-gradient-to-t from-black/85 via-black/20 to-transparent
    const grad = ctx.createLinearGradient(0, HEIGHT, 0, HEIGHT - 450);
    grad.addColorStop(0, "rgba(0, 0, 0, 0.85)");
    grad.addColorStop(0.5, "rgba(0, 0, 0, 0.20)");
    grad.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, HEIGHT - 450, WIDTH, 450);
  } else if (type === "radial_vignette") {
    // CSS: radial-gradient(circle,transparent_40%,rgba(0,0,0,0.65)_95%)
    const grad = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, WIDTH * 0.4, WIDTH / 2, HEIGHT / 2, HEIGHT * 0.7);
    grad.addColorStop(0, "rgba(0, 0, 0, 0)");
    grad.addColorStop(1, "rgba(0, 0, 0, 0.65)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  } else if (type === "sunset_glow") {
    // CSS: radial-gradient(circle_at_top_left,rgba(255,140,0,0.65)_0%,rgba(255,69,0,0)_60%)
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 600);
    grad.addColorStop(0, "rgba(255, 140, 0, 0.65)");
    grad.addColorStop(1, "rgba(255, 69, 0, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  } else if (type === "emerald_fade") {
    // CSS: radial-gradient(circle,transparent_40%,rgba(5,28,15,0.65)_95%)
    const grad = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, WIDTH * 0.4, WIDTH / 2, HEIGHT / 2, HEIGHT * 0.7);
    grad.addColorStop(0, "rgba(0, 0, 0, 0)");
    grad.addColorStop(1, "rgba(5, 28, 15, 0.65)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
}

function drawCaptions(
  ctx: Ctx,
  currentChunk: Word[],
  activeWordIdx: number,
  config: TemplateConfig,
) {
  const fontName = FONT_MAP[config.fontFamily] || "Montserrat";
  const fontSize = config.fontSize;
  const yCenter = config.positionY * HEIGHT;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `900 ${fontSize}px ${fontName}`;

  // Measure total line width for centering
  const words = currentChunk.map(w => w.word.toUpperCase());
  const gap = fontSize * 0.25; // space between words
  const wordWidths = words.map(w => ctx.measureText(w).width);
  const totalWidth = wordWidths.reduce((a, b) => a + b, 0) + gap * (words.length - 1);
  
  let x = (WIDTH - totalWidth) / 2;

  for (let i = 0; i < words.length; i++) {
    const isActive = i === activeWordIdx;
    const wordWidth = wordWidths[i];
    const wordX = x + wordWidth / 2;

    ctx.save();

    if (isActive) {
      const activeColor = config.activeColor === "multi" 
        ? MULTI_COLORS[i % MULTI_COLORS.length]
        : config.activeColor;
      
      // Scale effect (matching CSS transform: scale(1.12))
      ctx.translate(wordX, yCenter);
      ctx.scale(1.12, 1.12);
      ctx.translate(-wordX, -yCenter);

      // Neon glow effect (matching CSS text-shadow: 0 0 8px color, 0 0 16px color)
      ctx.shadowBlur = 16;
      ctx.shadowColor = activeColor + "80"; // 50% opacity glow
      ctx.fillStyle = activeColor;

      // Stroke (outline)
      if (config.strokeWidth > 0) {
        ctx.lineWidth = config.strokeWidth;
        ctx.strokeStyle = config.strokeColor;
        ctx.lineJoin = "round";
        ctx.miterLimit = 2;
        ctx.strokeText(words[i], wordX, yCenter);
      }

      ctx.fillText(words[i], wordX, yCenter);
      
      // Second pass for stronger glow
      ctx.shadowBlur = 8;
      ctx.shadowColor = activeColor + "cc"; // 80% opacity inner glow
      ctx.fillText(words[i], wordX, yCenter);
    } else {
      // Inactive word: white with outline
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#ffffff";

      if (config.strokeWidth > 0) {
        ctx.lineWidth = config.strokeWidth;
        ctx.strokeStyle = config.strokeColor;
        ctx.lineJoin = "round";
        ctx.miterLimit = 2;
        ctx.strokeText(words[i], wordX, yCenter);
      }

      ctx.fillText(words[i], wordX, yCenter);
    }

    ctx.restore();
    x += wordWidth + gap;
  }
}

// ─── Dark Overlay ───────────────────────────────────────────────────────────

function drawDarkOverlay(ctx: Ctx) {
  // Matches CSS: bg-black/45 — semi-transparent black layer for text legibility
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

// ─── Main Renderer ──────────────────────────────────────────────────────────

export async function renderCanvasOverlay(
  words: Word[],
  config: TemplateConfig,
  duration: number,
  outputPath: string,
): Promise<void> {
  registerFonts();

  const chunks = chunkWords(words);
  const totalFrames = Math.ceil(duration * FPS);
  const particles = config.particleFx !== "none" ? initParticles(config.particleFx) : [];

  console.log(`[Canvas Renderer] Rendering ${totalFrames} frames at ${FPS}fps (${duration.toFixed(1)}s)`);
  console.log(`[Canvas Renderer] Config: font=${config.fontFamily}, size=${config.fontSize}, active=${config.activeColor}`);
  console.log(`[Canvas Renderer] Effects: vignette=${config.vignette}, particles=${config.particleFx}`);
  console.log(`[Canvas Renderer] Output: ${outputPath}`);

  // Ensure output directory exists
  const outDir = path.dirname(outputPath);
  fs.mkdirSync(outDir, { recursive: true });

  // Write to temp file first, then atomic rename on success
  const tmpPath = outputPath + ".tmp";
  try { fs.unlinkSync(outputPath + ".ready"); } catch {}
  try { fs.unlinkSync(tmpPath); } catch {}
  try { fs.unlinkSync(outputPath); } catch {}

  // Spawn FFmpeg to receive raw RGBA frames and encode to WebM VP8 with alpha
  const ffmpegArgs = [
    "-y",
    "-f", "rawvideo",
    "-vcodec", "rawvideo",
    "-s", `${WIDTH}x${HEIGHT}`,
    "-pix_fmt", "rgba",
    "-r", String(FPS),
    "-i", "-",
    "-c:v", "libvpx",
    "-pix_fmt", "yuva420p",
    "-auto-alt-ref", "0",
    "-quality", "realtime",
    "-speed", "8",
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

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  for (let frame = 0; frame < totalFrames; frame++) {
    const t = frame / FPS; // current time in seconds

    // Clear to fully transparent
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    // 1. Dark overlay (bg-black/45)
    drawDarkOverlay(ctx);

    // 2. Vignette
    if (config.vignette !== "none") {
      drawVignette(ctx, config.vignette);
    }

    // 3. Particles
    if (particles.length > 0) {
      updateParticles(particles, config.particleFx, frame);
      drawParticles(ctx, particles, config.particleFx);
    }

    // 4. Captions — find current chunk and active word
    let currentChunk: Word[] | null = null;
    let activeWordIdx = 0;

    for (const chunk of chunks) {
      const chunkStart = chunk[0].start;
      const chunkEnd = chunk[chunk.length - 1].end;
      if (t >= chunkStart && t <= chunkEnd + 0.3) {
        currentChunk = chunk;
        // Find active word within chunk
        for (let i = 0; i < chunk.length; i++) {
          if (t >= chunk[i].start && t <= chunk[i].end) {
            activeWordIdx = i;
            break;
          }
          // If between words, keep the last one active
          if (i > 0 && t > chunk[i - 1].end && t < chunk[i].start) {
            activeWordIdx = i - 1;
          }
        }
        break;
      }
    }

    if (currentChunk) {
      drawCaptions(ctx, currentChunk, activeWordIdx, config);
    }

    // Write raw RGBA frame to FFmpeg stdin
    const imageData = ctx.getImageData(0, 0, WIDTH, HEIGHT);
    const buf = Buffer.from(imageData.data.buffer);
    
    const canWrite = ffmpeg.stdin.write(buf);
    if (!canWrite) {
      await new Promise<void>((resolve) => ffmpeg.stdin.once("drain", resolve));
    }

    // Progress logging every 2 seconds
    if (frame % (FPS * 2) === 0) {
      console.log(`[Canvas Renderer] Frame ${frame}/${totalFrames} (${((frame / totalFrames) * 100).toFixed(0)}%)`);
    }
  }

  // Close stdin and wait for FFmpeg to finish
  ffmpeg.stdin.end();

  return new Promise<void>((resolve, reject) => {
    ffmpeg.on("close", (code) => {
      if (code === 0 && fs.existsSync(tmpPath)) {
        const stat = fs.statSync(tmpPath);
        if (stat.size < 1024) {
          console.error(`[Canvas Renderer] Output file too small (${stat.size} bytes), discarding`);
          try { fs.unlinkSync(tmpPath); } catch {}
          reject(new Error("Canvas overlay output too small — likely corrupt"));
          return;
        }
        // Atomic rename: tmp → final path (prevents race conditions)
        fs.renameSync(tmpPath, outputPath);
        // Write .ready sentinel so batch renderer knows the file is fully written
        fs.writeFileSync(outputPath + ".ready", new Date().toISOString(), "utf-8");
        console.log(`[Canvas Renderer] Complete! Output: ${outputPath} (${(stat.size / 1024).toFixed(0)}KB)`);
        resolve();
      } else {
        console.error(`[Canvas Renderer] FFmpeg failed with code ${code}:`, ffmpegStderr.slice(-1000));
        try { fs.unlinkSync(tmpPath); } catch {}
        reject(new Error(`FFmpeg encoding failed with code ${code}`));
      }
    });

    ffmpeg.on("error", (err) => {
      console.error("[Canvas Renderer] FFmpeg spawn error:", err);
      try { fs.unlinkSync(tmpPath); } catch {}
      reject(err);
    });
  });
}
