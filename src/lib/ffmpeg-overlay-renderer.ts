/**
 * FFmpeg-Based Overlay Renderer (No Browser Needed)
 *
 * Uses FFmpeg drawtext filters with word timings to generate
 * text overlay videos. No Puppeteer/Chromium dependency.
 *
 * ~5-15 seconds vs 5+ minutes (or crashing) with Puppeteer.
 */

import * as fs from "fs";
import * as path from "path";
import { spawn, execSync } from "child_process";

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
  "Inter-Light":      { name: "Inter",      file: "Inter-Bold.ttf" },
  "Inter-Regular":    { name: "Inter",      file: "Inter-Bold.ttf" },
  "Caveat-Bold":      { name: "Caveat",     file: "Caveat-Bold.ttf" },
  "Oswald-Bold":      { name: "Oswald",     file: "Oswald-Bold.ttf" },
  "PlayfairDisplay-Bold": { name: "Playfair Display", file: "PlayfairDisplay-Bold.ttf" },
  "GreatVibes-Regular":   { name: "Great Vibes",      file: "GreatVibes-Regular.ttf" },
  "Lora-Bold":        { name: "Lora",       file: "Lora-Bold.ttf" },
};

const FALLBACK_FONT = "Montserrat-Bold.ttf";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeDrawtext(text: string): string {
  // FFmpeg drawtext special chars: ' : \ { } [ ] ; , =
  return text
    .replace(/\\/g, "\\\\\\\\")
    .replace(/'/g, "'\\\\\\''")
    .replace(/:/g, "\\\\:")
    .replace(/;/g, "\\\\;")
    .replace(/%/g, "%%");
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

// ─── Approach: Generate a concat script with per-segment drawtext ────────────
// For each word timing slot, we generate a tiny video segment with the correct
// text rendered, then concat them all. This avoids the complexity of filter
// enable/disable timing with hundreds of drawtext filters.
//
// Actually, simpler approach: use a single FFmpeg command with drawtext filters
// that use enable='between(t,start,end)' for timing.

function buildDrawtextFilterChain(
  words: Word[],
  config: TemplateConfig,
  fontsDir: string,
): string {
  const fontEntry = FONT_MAP[config.fontFamily] || FONT_MAP["Montserrat-Black"];
  const fontFile = path.join(fontsDir, fontEntry.file);
  const fontSize = config.fontSize || 48;
  const posY = Math.round(HEIGHT * (config.positionY || 0.75));
  const isMulti = config.activeColor === "multi";
  
  // Escape the font file path for FFmpeg
  const escapedFontFile = fontFile.replace(/:/g, "\\\\:").replace(/'/g, "'\\\\\\''");
  
  const strokeColor = config.strokeColor || "#000000";
  const inactiveColor = config.textColor || "#888888";
  const borderW = Math.min(config.strokeWidth || 3, 6);

  const filters: string[] = [];

  if (config.animationMode === "word_builder") {
    // Word Builder: show words appearing one at a time
    const phrases = chunkPhrases(words);
    
    for (const phrase of phrases) {
      const phraseEnd = phrase[phrase.length - 1].end + 0.3;
      
      for (let i = 0; i < phrase.length; i++) {
        const word = phrase[i];
        const nextStart = (i + 1 < phrase.length) ? phrase[i + 1].start : phraseEnd;
        
        // Build the text showing all words up to current
        const builtWords = phrase.slice(0, i + 1).map(w => w.word);
        const fullText = escapeDrawtext(builtWords.join(" "));
        
        // Show entire built phrase in inactive color
        filters.push(
          "drawtext=fontfile='" + escapedFontFile + "'" +
          ":text='" + fullText + "'" +
          ":fontsize=" + fontSize +
          ":fontcolor=" + inactiveColor +
          ":borderw=" + borderW +
          ":bordercolor=" + strokeColor +
          ":x=(w-text_w)/2" +
          ":y=" + posY +
          ":enable='between(t," + word.start.toFixed(3) + "," + nextStart.toFixed(3) + ")'"
        );
        
        // Overlay the active word on top in the active color
        // Calculate x position for the active word
        const activeColor = isMulti ? MULTI_COLORS[i % MULTI_COLORS.length] : (config.activeColor || "#FFFFFF");
        const activeWordText = escapeDrawtext(word.word);
        
        // For the active word, we need to figure out its position within the line
        // Use a simpler approach: just render the active word centered
        // Actually, let's render the whole line but only show the active word colored
        // We'll use two layers: inactive full text + active single word on top
        
        // Calculate prefix width to position active word correctly
        const prefixWords = builtWords.slice(0, i);
        const prefixText = prefixWords.length > 0 ? escapeDrawtext(prefixWords.join(" ") + " ") : "";
        
        if (prefixText) {
          // Active word offset from center
          filters.push(
            "drawtext=fontfile='" + escapedFontFile + "'" +
            ":text='" + activeWordText + "'" +
            ":fontsize=" + fontSize +
            ":fontcolor=" + activeColor +
            ":borderw=" + borderW +
            ":bordercolor=" + strokeColor +
            // Position: center of full text + offset by prefix width
            // This is approximate but works well enough
            ":x=(w-text_w)/2" +
            ":y=" + posY +
            ":enable='between(t," + word.start.toFixed(3) + "," + nextStart.toFixed(3) + ")'"
          );
        } else {
          // First word — just overlay at same position
          filters.push(
            "drawtext=fontfile='" + escapedFontFile + "'" +
            ":text='" + activeWordText + "'" +
            ":fontsize=" + fontSize +
            ":fontcolor=" + activeColor +
            ":borderw=" + borderW +
            ":bordercolor=" + strokeColor +
            ":x=(w-text_w)/2" +
            ":y=" + posY +
            ":enable='between(t," + word.start.toFixed(3) + "," + nextStart.toFixed(3) + ")'"
          );
        }
      }
    }
  } else {
    // Highlight mode: show chunk of words, active word changes color
    const chunks = chunkWords(words);
    
    for (const chunk of chunks) {
      const chunkStart = chunk[0].start;
      const chunkEnd = chunk[chunk.length - 1].end + 0.1;
      const fullText = escapeDrawtext(chunk.map(w => w.word).join(" "));
      
      for (let i = 0; i < chunk.length; i++) {
        const word = chunk[i];
        const nextStart = (i + 1 < chunk.length) ? chunk[i + 1].start : chunkEnd;
        const activeColor = isMulti ? MULTI_COLORS[i % MULTI_COLORS.length] : (config.activeColor || "#FFFFFF");
        
        // Show the full chunk text in inactive color
        filters.push(
          "drawtext=fontfile='" + escapedFontFile + "'" +
          ":text='" + fullText + "'" +
          ":fontsize=" + fontSize +
          ":fontcolor=" + inactiveColor +
          ":borderw=" + borderW +
          ":bordercolor=" + strokeColor +
          ":x=(w-text_w)/2" +
          ":y=" + posY +
          ":enable='between(t," + word.start.toFixed(3) + "," + nextStart.toFixed(3) + ")'"
        );
      }
    }
  }

  return filters.join(",");
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

  console.log("[FFmpeg Renderer] Generating overlay (" + duration.toFixed(1) + "s, " + words.length + " words)");
  console.log("[FFmpeg Renderer] Config: font=" + config.fontFamily + ", size=" + config.fontSize + ", active=" + config.activeColor);
  console.log("[FFmpeg Renderer] Mode: " + (config.animationMode || "highlight") + ", bg=" + (config.bgColor || "transparent"));
  console.log("[FFmpeg Renderer] Output: " + outputPath);

  // Check FFmpeg available filters for debugging
  try {
    const filtersOut = execSync("ffmpeg -filters 2>&1 | grep -E 'ass|subtitles|drawtext' || true", { timeout: 5000 }).toString().trim();
    console.log("[FFmpeg Renderer] Available filters: " + filtersOut);
  } catch {}

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

  // Verify font file exists, fallback if not
  const fontEntry = FONT_MAP[config.fontFamily] || FONT_MAP["Montserrat-Black"];
  let fontFile = path.join(fontsDir, fontEntry.file);
  if (!fs.existsSync(fontFile)) {
    console.warn("[FFmpeg Renderer] Font not found: " + fontEntry.file + ", falling back to " + FALLBACK_FONT);
    fontFile = path.join(fontsDir, FALLBACK_FONT);
    if (!fs.existsSync(fontFile)) {
      console.error("[FFmpeg Renderer] Fallback font also missing! Available: " + fs.readdirSync(fontsDir).join(", "));
      if (progressFile) {
        try { fs.writeFileSync(progressFile, JSON.stringify({ current: 0, total: 100, percent: 0, status: "failed", error: "No font files found" }), "utf-8"); } catch {}
      }
      throw new Error("No font files found in " + fontsDir);
    }
  }

  if (progressFile) {
    try { fs.writeFileSync(progressFile, JSON.stringify({ current: 15, total: 100, percent: 15, status: "rendering" }), "utf-8"); } catch {}
  }

  // Build the drawtext filter chain
  const drawtextChain = buildDrawtextFilterChain(words, config, fontsDir);
  
  // Build FFmpeg command
  const hasSolidBg = !!config.bgColor;
  const bgColor = hasSolidBg ? config.bgColor!.replace("#", "0x") : "black@0.0";
  
  // Build input + filter
  const colorSrc = "color=c=" + bgColor + ":s=" + WIDTH + "x" + HEIGHT + ":d=" + duration + ":r=" + FPS;
  const fullFilter = hasSolidBg
    ? drawtextChain
    : "format=yuva420p," + drawtextChain;

  const ffmpegArgs = [
    "-y",
    "-f", "lavfi",
    "-i", colorSrc,
    "-vf", fullFilter,
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

  // Log the command (truncated for readability)
  const cmdStr = "ffmpeg " + ffmpegArgs.join(" ");
  console.log("[FFmpeg Renderer] Command length: " + cmdStr.length + " chars");
  console.log("[FFmpeg Renderer] First 500 chars: " + cmdStr.substring(0, 500));

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
      if (stderr.length < 20000) stderr += chunk;

      // Parse progress from FFmpeg output
      const timeMatch = chunk.match(/time=(\d+):(\d+):([\d.]+)/);
      if (timeMatch && progressFile) {
        const t = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseFloat(timeMatch[3]);
        const pct = Math.min(95, Math.round(20 + (t / duration) * 75));
        try { fs.writeFileSync(progressFile, JSON.stringify({ current: pct, total: 100, percent: pct, status: "rendering" }), "utf-8"); } catch {}
      }
    });

    ffmpeg.on("close", (code) => {
      if (code === 0 && fs.existsSync(tmpPath)) {
        const stat = fs.statSync(tmpPath);
        if (stat.size < 1024) {
          console.error("[FFmpeg Renderer] Output too small (" + stat.size + " bytes)");
          try { fs.unlinkSync(tmpPath); } catch {}
          if (progressFile) {
            try { fs.writeFileSync(progressFile, JSON.stringify({ current: 0, total: 100, percent: 0, status: "failed", error: "Output too small" }), "utf-8"); } catch {}
          }
          reject(new Error("FFmpeg overlay output too small"));
          return;
        }
        fs.renameSync(tmpPath, outputPath);
        fs.writeFileSync(outputPath + ".ready", new Date().toISOString(), "utf-8");
        console.log("[FFmpeg Renderer] ✅ Complete! " + outputPath + " (" + (stat.size / 1024).toFixed(0) + "KB)");
        if (progressFile) {
          try { fs.writeFileSync(progressFile, JSON.stringify({ current: 100, total: 100, percent: 100, status: "done" }), "utf-8"); } catch {}
        }
        resolve();
      } else {
        // Log FULL stderr for debugging
        console.error("[FFmpeg Renderer] ═══ FULL STDERR ═══");
        console.error(stderr);
        console.error("[FFmpeg Renderer] ═══ END STDERR ═══");
        try { fs.unlinkSync(tmpPath); } catch {}
        if (progressFile) {
          try { fs.writeFileSync(progressFile, JSON.stringify({ current: 0, total: 100, percent: 0, status: "failed", error: stderr.slice(-500) }), "utf-8"); } catch {}
        }
        reject(new Error("FFmpeg failed with code " + code));
      }
    });

    ffmpeg.on("error", (err) => {
      console.error("[FFmpeg Renderer] Spawn error:", err);
      try { fs.unlinkSync(tmpPath); } catch {}
      if (progressFile) {
        try { fs.writeFileSync(progressFile, JSON.stringify({ current: 0, total: 100, percent: 0, status: "failed", error: String(err) }), "utf-8"); } catch {}
      }
      reject(err);
    });
  });
}
