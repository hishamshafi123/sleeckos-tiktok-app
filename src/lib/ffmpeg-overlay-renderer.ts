/**
 * FFmpeg-Based Overlay Renderer (No Browser Needed)
 *
 * Generates styled ASS subtitles from word timings + template config,
 * then burns them onto a transparent canvas via FFmpeg's `ass` filter.
 * Output is a WebM VP8 with alpha channel (or solid bg).
 *
 * ~5-10 seconds vs 5+ minutes with Puppeteer.
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
  animationMode?: "highlight" | "word_builder";
  bgColor?: string | null;
  textColor?: string | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const WIDTH = 720;
const HEIGHT = 1280;
const FPS = 15;

const MULTI_COLORS = ["#FFFF00", "#00FF00", "#00FFFF", "#FF00FF", "#FF5F00", "#FF007F"];

// ─── Font Mapping ────────────────────────────────────────────────────────────

const FONT_MAP: Record<string, { name: string; file: string }> = {
  "Montserrat-Black": { name: "Montserrat", file: "Montserrat-Bold.ttf" },
  "Outfit-Bold":      { name: "Outfit",     file: "Outfit-Bold.ttf" },
  "Anton":            { name: "Anton",      file: "Anton.ttf" },
  "Inter-Bold":       { name: "Inter",      file: "Inter-Bold.ttf" },
  "Inter-Light":      { name: "Inter",      file: "Inter-Light.ttf" },
  "Inter-Regular":    { name: "Inter",      file: "Inter-Regular.ttf" },
  "Caveat-Bold":      { name: "Caveat",     file: "Caveat-Bold.ttf" },
  "Oswald-Bold":      { name: "Oswald",     file: "Oswald-Bold.ttf" },
  "PlayfairDisplay-Bold": { name: "Playfair Display", file: "PlayfairDisplay-Bold.ttf" },
  "GreatVibes-Regular":   { name: "Great Vibes",      file: "GreatVibes-Regular.ttf" },
  "Lora-Bold":        { name: "Lora",       file: "Lora-Bold.ttf" },
};

// ─── ASS Helpers ─────────────────────────────────────────────────────────────

function hexToASS(hex: string): string {
  // ASS color format: &HAABBGGRR (alpha, blue, green, red)
  const clean = hex.replace("#", "");
  if (clean.length === 6) {
    const r = clean.substring(0, 2);
    const g = clean.substring(2, 4);
    const b = clean.substring(4, 6);
    return `&H00${b}${g}${r}`.toUpperCase();
  }
  return "&H00FFFFFF";
}

function secondsToASS(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${sec.toFixed(2).padStart(5, "0")}`;
}

function escapeASS(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/\n/g, "\\N");
}

// ─── Word Chunking ───────────────────────────────────────────────────────────

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

function chunkPhrases(words: Word[]): Word[][] {
  const phrases: Word[][] = [];
  let current: Word[] = [];
  let lastEnd = 0;

  for (const w of words) {
    if (current.length > 0 && (w.start - lastEnd > 1.5 || current.length >= 12)) {
      phrases.push(current);
      current = [];
    }
    current.push(w);
    lastEnd = w.end;
  }
  if (current.length > 0) phrases.push(current);
  return phrases;
}

// ─── ASS File Generator ─────────────────────────────────────────────────────

function generateASS(words: Word[], config: TemplateConfig): string {
  const fontEntry = FONT_MAP[config.fontFamily] || FONT_MAP["Montserrat-Black"];
  const fontName = fontEntry.name;
  const fontSize = config.fontSize || 48;
  const posY = Math.round(HEIGHT * (config.positionY || 0.75));
  
  const activeColor = hexToASS(config.activeColor === "multi" ? "#FFFF00" : config.activeColor || "#FFFFFF");
  const inactiveColor = config.textColor ? hexToASS(config.textColor) : "&H00888888";
  const strokeColor = hexToASS(config.strokeColor || "#000000");
  const outline = Math.min(config.strokeWidth || 3, 6);

  let ass = `[Script Info]
Title: Lyrical Overlay
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: None
PlayResX: ${WIDTH}
PlayResY: ${HEIGHT}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${fontSize},${activeColor},${activeColor},${strokeColor},&H00000000,1,0,0,0,100,100,0,0,1,${outline},0,5,20,20,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events: string[] = [];
  const isMulti = config.activeColor === "multi";

  if (config.animationMode === "word_builder") {
    const phrases = chunkPhrases(words);
    for (const phrase of phrases) {
      const phraseEnd = phrase[phrase.length - 1].end + 0.3;
      for (let i = 0; i < phrase.length; i++) {
        const word = phrase[i];
        const nextStart = (i + 1 < phrase.length) ? phrase[i + 1].start : phraseEnd;
        
        const ac = isMulti ? hexToASS(MULTI_COLORS[i % MULTI_COLORS.length]) : activeColor;
        
        const text = phrase.slice(0, i + 1).map((w, j) => {
          const c = j === i ? ac : inactiveColor;
          return `{\\c${c}}${escapeASS(w.word)}{\\r}`;
        }).join(" ");
        
        events.push(`Dialogue: 0,${secondsToASS(word.start)},${secondsToASS(nextStart)},Default,,0,0,0,,{\\pos(${WIDTH / 2},${posY})}${text}`);
      }
    }
  } else {
    const chunks = chunkWords(words);
    for (const chunk of chunks) {
      const chunkEnd = chunk[chunk.length - 1].end + 0.1;
      for (let i = 0; i < chunk.length; i++) {
        const word = chunk[i];
        const nextStart = (i + 1 < chunk.length) ? chunk[i + 1].start : chunkEnd;
        
        const ac = isMulti ? hexToASS(MULTI_COLORS[i % MULTI_COLORS.length]) : activeColor;
        
        const text = chunk.map((w, j) => {
          const c = j === i ? ac : inactiveColor;
          return `{\\c${c}}${escapeASS(w.word)}{\\r}`;
        }).join(" ");
        
        events.push(`Dialogue: 0,${secondsToASS(word.start)},${secondsToASS(nextStart)},Default,,0,0,0,,{\\pos(${WIDTH / 2},${posY})}${text}`);
      }
    }
  }

  return ass + events.join("\n") + "\n";
}

// ─── Main Overlay Renderer ──────────────────────────────────────────────────

export async function renderCanvasOverlay(
  words: Word[],
  config: TemplateConfig,
  duration: number,
  outputPath: string,
  progressFile?: string,
): Promise<void> {
  const fontsDir = path.join(process.cwd(), "public", "fonts");

  console.log(`[FFmpeg Renderer] Generating overlay (${duration.toFixed(1)}s)`);
  console.log(`[FFmpeg Renderer] Config: font=${config.fontFamily}, size=${config.fontSize}, active=${config.activeColor}`);
  console.log(`[FFmpeg Renderer] Mode: ${config.animationMode || "highlight"}, bg=${config.bgColor || "transparent"}`);
  console.log(`[FFmpeg Renderer] Output: ${outputPath}`);

  if (progressFile) {
    try { fs.writeFileSync(progressFile, JSON.stringify({ current: 5, total: 100, percent: 5, status: "rendering" }), "utf-8"); } catch {}
  }

  // Ensure output directory
  const outDir = path.dirname(outputPath);
  fs.mkdirSync(outDir, { recursive: true });

  // Atomic write
  const tmpPath = outputPath + ".tmp";
  try { fs.unlinkSync(outputPath + ".ready"); } catch {}
  try { fs.unlinkSync(tmpPath); } catch {}
  try { fs.unlinkSync(outputPath); } catch {}

  // Generate ASS subtitle file
  const assContent = generateASS(words, config);
  const assPath = path.join("/tmp", `overlay_${Date.now()}.ass`);
  fs.writeFileSync(assPath, assContent, "utf-8");
  console.log(`[FFmpeg Renderer] ASS file: ${assPath} (${(assContent.length / 1024).toFixed(1)}KB)`);

  if (progressFile) {
    try { fs.writeFileSync(progressFile, JSON.stringify({ current: 15, total: 100, percent: 15, status: "rendering" }), "utf-8"); } catch {}
  }

  // Build FFmpeg command
  const hasSolidBg = !!config.bgColor;
  
  const inputFilter = hasSolidBg
    ? `color=c=${config.bgColor!.replace("#", "0x")}:s=${WIDTH}x${HEIGHT}:d=${duration}:r=${FPS}`
    : `color=c=black@0.0:s=${WIDTH}x${HEIGHT}:d=${duration}:r=${FPS},format=yuva420p`;

  // Escape paths for FFmpeg filter
  const escapedAss = assPath.replace(/:/g, "\\:").replace(/'/g, "'\\''");
  const escapedFonts = fontsDir.replace(/:/g, "\\:").replace(/'/g, "'\\''");

  const ffmpegArgs = [
    "-y",
    "-f", "lavfi",
    "-i", inputFilter,
    "-vf", `ass=${escapedAss}:fontsdir=${escapedFonts}`,
    "-c:v", "libvpx",
    "-pix_fmt", hasSolidBg ? "yuv420p" : "yuva420p",
    "-auto-alt-ref", "0",
    "-quality", "realtime",
    "-speed", "5",
    "-crf", hasSolidBg ? "20" : "23",
    "-b:v", hasSolidBg ? "4M" : "2M",
    "-t", String(duration),
    tmpPath,
  ];

  console.log(`[FFmpeg Renderer] Command: ffmpeg ${ffmpegArgs.join(" ")}`);

  if (progressFile) {
    try { fs.writeFileSync(progressFile, JSON.stringify({ current: 20, total: 100, percent: 20, status: "rendering" }), "utf-8"); } catch {}
  }

  // Run FFmpeg
  await new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", ffmpegArgs, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    ffmpeg.stderr!.on("data", (data: Buffer) => {
      const chunk = data.toString();
      if (stderr.length < 5000) stderr += chunk;

      // Parse progress from FFmpeg output
      const timeMatch = chunk.match(/time=(\d+):(\d+):([\d.]+)/);
      if (timeMatch && progressFile) {
        const t = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseFloat(timeMatch[3]);
        const pct = Math.min(95, Math.round(20 + (t / duration) * 75));
        try { fs.writeFileSync(progressFile, JSON.stringify({ current: pct, total: 100, percent: pct, status: "rendering" }), "utf-8"); } catch {}
      }
    });

    ffmpeg.on("close", (code) => {
      // Cleanup ASS file
      try { fs.unlinkSync(assPath); } catch {}

      if (code === 0 && fs.existsSync(tmpPath)) {
        const stat = fs.statSync(tmpPath);
        if (stat.size < 1024) {
          console.error(`[FFmpeg Renderer] Output too small (${stat.size} bytes)`);
          try { fs.unlinkSync(tmpPath); } catch {}
          if (progressFile) {
            try { fs.writeFileSync(progressFile, JSON.stringify({ current: 0, total: 100, percent: 0, status: "failed", error: "Output too small" }), "utf-8"); } catch {}
          }
          reject(new Error("FFmpeg overlay output too small"));
          return;
        }
        fs.renameSync(tmpPath, outputPath);
        fs.writeFileSync(outputPath + ".ready", new Date().toISOString(), "utf-8");
        console.log(`[FFmpeg Renderer] ✅ Complete! ${outputPath} (${(stat.size / 1024).toFixed(0)}KB)`);
        if (progressFile) {
          try { fs.writeFileSync(progressFile, JSON.stringify({ current: 100, total: 100, percent: 100, status: "done" }), "utf-8"); } catch {}
        }
        resolve();
      } else {
        console.error(`[FFmpeg Renderer] Failed code=${code}:`, stderr.slice(-500));
        try { fs.unlinkSync(tmpPath); } catch {}
        if (progressFile) {
          try { fs.writeFileSync(progressFile, JSON.stringify({ current: 0, total: 100, percent: 0, status: "failed", error: stderr.slice(-200) }), "utf-8"); } catch {}
        }
        reject(new Error(`FFmpeg failed with code ${code}: ${stderr.slice(-200)}`));
      }
    });

    ffmpeg.on("error", (err) => {
      try { fs.unlinkSync(assPath); } catch {}
      try { fs.unlinkSync(tmpPath); } catch {}
      if (progressFile) {
        try { fs.writeFileSync(progressFile, JSON.stringify({ current: 0, total: 100, percent: 0, status: "failed", error: String(err) }), "utf-8"); } catch {}
      }
      reject(err);
    });
  });
}
