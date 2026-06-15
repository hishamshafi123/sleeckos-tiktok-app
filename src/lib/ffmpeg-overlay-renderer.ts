/**
 * FFmpeg-Based Overlay Renderer (No Browser Needed)
 *
 * Generates styled ASS subtitles from word timings + template config,
 * then burns them onto a transparent canvas via FFmpeg's `ass` filter.
 * Uses filter_complex_script to avoid command-line escaping issues.
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
  animationMode?: "highlight" | "word_builder" | "brat";
  bgColor?: string | null;
  textColor?: string | null;
  textAlign?: string;
  wordSpacing?: string;
  letterSpacing?: number;
  aspectRatio?: string;
  bgOpacity?: number;
  lofiFactor?: number;
  textMargin?: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const WIDTH = 720;
const HEIGHT = 1280;
const FPS = 15;

const MULTI_COLORS = ["#FFFF00", "#00FF00", "#00FFFF", "#FF00FF", "#FF5F00", "#FF007F"];

// ─── Font Mapping ────────────────────────────────────────────────────────────

const FONT_MAP: Record<string, { name: string; file: string; weight: number }> = {
  "Montserrat-Black": { name: "Montserrat", file: "Montserrat-Bold.ttf", weight: 900 },
  "Outfit-Bold":      { name: "Outfit",     file: "Outfit-Bold.ttf", weight: 700 },
  "Anton":            { name: "Anton",      file: "Anton.ttf", weight: 400 },
  "Inter-Bold":       { name: "Inter",      file: "Inter-Bold.ttf", weight: 700 },
  "Inter-Light":      { name: "Inter",      file: "Inter-Light.ttf", weight: 300 },
  "Inter-Regular":    { name: "Inter",      file: "Inter-Regular.ttf", weight: 400 },
  "Caveat-Bold":      { name: "Caveat",     file: "Caveat-Bold.ttf", weight: 700 },
  "Oswald-Bold":      { name: "Oswald",     file: "Oswald-Bold.ttf", weight: 700 },
  "PlayfairDisplay-Bold": { name: "Playfair Display", file: "PlayfairDisplay-Bold.ttf", weight: 700 },
  "GreatVibes-Regular":   { name: "Great Vibes",      file: "GreatVibes-Regular.ttf", weight: 400 },
  "Lora-Bold":        { name: "Lora",       file: "Lora-Bold.ttf", weight: 700 },
};

const FALLBACK_FONT_FILE = "Montserrat-Bold.ttf";

// ─── ASS Helpers ─────────────────────────────────────────────────────────────

function hexToASS(hex: string): string {
  // ASS color: &HAABBGGRR&
  const clean = hex.replace("#", "");
  if (clean.length === 6) {
    const r = clean.substring(0, 2);
    const g = clean.substring(2, 4);
    const b = clean.substring(4, 6);
    return "&H00" + b + g + r + "&";
  }
  return "&H00FFFFFF&";
}

function secondsToASS(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h + ":" + String(m).padStart(2, "0") + ":" + sec.toFixed(2).padStart(5, "0");
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

// ─── Dynamic Layout Sizing and Positioning Engine for Brat Subtitles ─────────

function estimateTextWidth(text: string, fontSize: number, fontFamily: string): number {
  let width = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    let factor = 0.53; // baseline factor
    if (char >= 'A' && char <= 'Z') factor = 0.68;
    else if (char >= 'a' && char <= 'z') factor = 0.50;
    else if (char >= '0' && char <= '9') factor = 0.53;
    else if (char === ' ' || char === '\xa0') factor = 0.28;
    else if (char === 'i' || char === 'l' || char === 't' || char === 'I' || char === '!') factor = 0.23;
    else if (char === 'w' || char === 'm' || char === 'W' || char === 'M') factor = 0.82;
    
    if (fontFamily.includes("Black") || fontFamily.includes("Bold") || fontFamily.includes("Anton")) {
      factor *= 1.1;
    }
    width += factor * fontSize;
  }
  return width;
}

function getWrappedLines(words: string[], fontSize: number, fontFamily: string, maxWidth: number): string[][] {
  const lines: string[][] = [];
  let currentLine: string[] = [];
  const spaceWidth = estimateTextWidth(" ", fontSize, fontFamily);
  let currentWidth = 0;

  for (const wordText of words) {
    const wordWidth = estimateTextWidth(wordText, fontSize, fontFamily);
    if (currentLine.length === 0) {
      currentLine.push(wordText);
      currentWidth = wordWidth;
    } else {
      const newWidth = currentWidth + spaceWidth + wordWidth;
      if (newWidth <= maxWidth) {
        currentLine.push(wordText);
        currentWidth = newWidth;
      } else {
        lines.push(currentLine);
        currentLine = [wordText];
        currentWidth = wordWidth;
      }
    }
  }
  if (currentLine.length > 0) {
    lines.push(currentLine);
  }
  return lines;
}

function getOptimalFontSize(words: string[], maxWidth: number, maxHeight: number, fontFamily: string, baseFontSize: number): number {
  const minFont = 20;
  const maxFont = baseFontSize; // Max size is starting size
  
  function checkFit(size: number): boolean {
    const lines = getWrappedLines(words, size, fontFamily, maxWidth);
    const lineHeight = size * 1.15;
    const totalHeight = lineHeight * lines.length + 10 * (lines.length - 1);
    
    // Check if any word width itself exceeds maxWidth
    for (const w of words) {
      if (estimateTextWidth(w, size, fontFamily) > maxWidth) {
        return false;
      }
    }
    return totalHeight <= maxHeight;
  }
  
  let low = minFont;
  let high = maxFont;
  let bestSize = minFont;
  
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (checkFit(mid)) {
      bestSize = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return bestSize;
}

function calculateWordPositions(
  lines: string[][],
  fontSize: number,
  canvasWidth: number,
  canvasHeight: number,
  margin: number,
  fontFamily: string
) {
  const targetWidth = canvasWidth - 2 * margin;
  const startX = margin;
  const startY = Math.round(canvasHeight * 0.2);
  const spaceWidth = estimateTextWidth(" ", fontSize, fontFamily);
  const lineHeight = fontSize * 1.15;
  const lineSpacing = 10;
  
  let currentY = startY;
  const wordPositions: { text: string; x: number; y: number; fontSize: number }[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const lineWords = lines[i];
    if (lineWords.length === 0) continue;
    
    const isLastLine = (i === lines.length - 1);
    
    // Calculate natural width with normal spaces
    let sumWordW = 0;
    const wordWidths = lineWords.map(w => {
      const w_w = estimateTextWidth(w, fontSize, fontFamily);
      sumWordW += w_w;
      return w_w;
    });
    
    const normalGapW = (lineWords.length - 1) * spaceWidth;
    const naturalWidth = sumWordW + normalGapW;
    
    // Threshold: if natural width > 85% of target width, justify it even if last line
    const isFullEnough = (naturalWidth / targetWidth) > 0.85;
    const shouldLeftAlign = (isLastLine && !isFullEnough) || lineWords.length === 1;
    
    if (shouldLeftAlign) {
      let currX = startX;
      for (let j = 0; j < lineWords.length; j++) {
        const w = lineWords[j];
        wordPositions.push({
          text: w,
          x: Math.round(currX),
          y: Math.round(currentY),
          fontSize
        });
        currX += wordWidths[j] + spaceWidth;
      }
    } else {
      // Justified alignment
      const availableSpace = targetWidth - sumWordW;
      const gap = lineWords.length > 1 ? (availableSpace / (lineWords.length - 1)) : 0;
      let currX = startX;
      
      for (let j = 0; j < lineWords.length; j++) {
        const w = lineWords[j];
        wordPositions.push({
          text: w,
          x: Math.round(currX),
          y: Math.round(currentY),
          fontSize
        });
        currX += wordWidths[j] + gap;
      }
    }
    
    currentY += lineHeight + lineSpacing;
  }
  
  return wordPositions;
}

// ─── ASS File Generator ─────────────────────────────────────────────────────

export function generateASS(words: Word[], config: TemplateConfig): string {
  const fontEntry = FONT_MAP[config.fontFamily] || FONT_MAP["Montserrat-Black"];
  const fontName = fontEntry.name;
  const fontSize = config.fontSize || 48;
  const width = config.aspectRatio === "1:1" ? 720 : 720;
  const height = config.aspectRatio === "1:1" ? 720 : 1280;
  const posY = Math.round(height * (config.positionY || 0.75));

  const activeColor = hexToASS(config.activeColor === "multi" ? "#FFFF00" : config.activeColor || "#FFFFFF");
  const inactiveColor = config.textColor ? hexToASS(config.textColor) : "&H00888888&";
  const strokeColor = hexToASS(config.strokeColor || "#000000");
  const outline = Math.min(config.strokeWidth ?? 3, 6);

  const isMulti = config.activeColor === "multi";
  const boldVal = fontEntry.weight || 700;

  // Build ASS file using string array (no template literals to avoid escape confusion)
  const lines: string[] = [];
  lines.push("[Script Info]");
  lines.push("Title: Lyrical Overlay");
  lines.push("ScriptType: v4.00+");
  lines.push("WrapStyle: 0");
  lines.push("ScaledBorderAndShadow: yes");
  lines.push("YCbCr Matrix: None");
  lines.push("PlayResX: " + width);
  lines.push("PlayResY: " + height);
  lines.push("");
  lines.push("[V4+ Styles]");
  lines.push("Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding");
  lines.push("Style: Default," + fontName + "," + fontSize + "," + activeColor + "," + activeColor + "," + strokeColor + ",&H00000000," + boldVal + ",0,0,0,100,100," + (config.letterSpacing || 0) + ",0,1," + outline + ",0,5,20,20,10,1");
  lines.push("");
  lines.push("[Events]");
  lines.push("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text");

  // Determine spacing spacer based on config
  const wordSpacer = (() => {
    if (config.wordSpacing === "wide") return " \\h ";
    if (config.wordSpacing === "extra_wide") return " \\h \\h ";
    if (config.wordSpacing === "normal") return " ";
    return config.animationMode === "word_builder" ? " \\h \\h " : " ";
  })();

  const alignTag = config.textAlign === "left" ? "\\an4" : config.textAlign === "right" ? "\\an6" : "\\an5";
  const alignX = config.textAlign === "left" ? 50 : config.textAlign === "right" ? (width - 50) : (width / 2);

  if (config.animationMode === "brat") {
    const phrases = chunkPhrases(words);
    const margin = config.textMargin ?? 50;
    const textColorHex = config.textColor || "#000000";
    const textASSColor = hexToASS(textColorHex);

    for (const phrase of phrases) {
      const phraseEnd = phrase[phrase.length - 1].end + 0.3;
      for (let i = 0; i < phrase.length; i++) {
        const word = phrase[i];
        const nextStart = (i + 1 < phrase.length) ? phrase[i + 1].start : phraseEnd;

        // 1. Get currently visible words
        const currentWords = phrase.slice(0, i + 1);
        const currentWordsText = currentWords.map(w => w.word);

        // 2. Compute font size & positions
        const bestSize = getOptimalFontSize(currentWordsText, width - 2 * margin, height * 0.6, fontName, fontSize);
        const wrappedLines = getWrappedLines(currentWordsText, bestSize, fontName, width - 2 * margin);
        const wordPositions = calculateWordPositions(wrappedLines, bestSize, width, height, margin, fontName);

        // 3. For this time segment, output a dialogue line for each word!
        for (let j = 0; j < wordPositions.length; j++) {
          const item = wordPositions[j];
          const text = "{\\an7\\pos(" + item.x + "," + item.y + ")\\fs" + item.fontSize + "\\fn" + fontName + "\\bord" + outline + "\\3c" + strokeColor + "\\c" + textASSColor + "}" + item.text.toLowerCase();
          lines.push("Dialogue: 0," + secondsToASS(word.start) + "," + secondsToASS(nextStart) + ",Default,,0,0,0,," + text);
        }
      }
    }
  } else if (config.animationMode === "word_builder") {
    const phrases = chunkPhrases(words);
    for (const phrase of phrases) {
      const phraseEnd = phrase[phrase.length - 1].end + 0.3;
      for (let i = 0; i < phrase.length; i++) {
        const word = phrase[i];
        const nextStart = (i + 1 < phrase.length) ? phrase[i + 1].start : phraseEnd;
        const ac = isMulti ? hexToASS(MULTI_COLORS[i % MULTI_COLORS.length]) : activeColor;

        // Build text: all words up to current, active word is highlighted.
        // Convert to lowercase and join with non-breaking spaces to match the web preview's visual layout.
        const textParts: string[] = [];
        for (let j = 0; j <= i; j++) {
          const c = j === i ? ac : inactiveColor;
          const wordText = phrase[j].word.toLowerCase();
          textParts.push("{\\c" + c + "}" + wordText + "{\\r}");
        }
        const dialogueText = "{\\pos(" + alignX + "," + posY + ")" + alignTag + "}" + textParts.join(wordSpacer);
        lines.push("Dialogue: 0," + secondsToASS(word.start) + "," + secondsToASS(nextStart) + ",Default,,0,0,0,," + dialogueText);
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

        const textParts: string[] = [];
        for (let j = 0; j < chunk.length; j++) {
          const c = j === i ? ac : inactiveColor;
          textParts.push("{\\c" + c + "}" + chunk[j].word + "{\\r}");
        }
        const dialogueText = "{\\pos(" + alignX + "," + posY + ")" + alignTag + "}" + textParts.join(wordSpacer);
        lines.push("Dialogue: 0," + secondsToASS(word.start) + "," + secondsToASS(nextStart) + ",Default,,0,0,0,," + dialogueText);
      }
    }
  }

  return lines.join("\n") + "\n";
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

  if (progressFile) {
    try { fs.writeFileSync(progressFile, JSON.stringify({ current: 5, total: 100, percent: 5, status: "rendering" }), "utf-8"); } catch {}
  }

  // Ensure output directory
  const outDir = path.dirname(outputPath);
  fs.mkdirSync(outDir, { recursive: true });

  // Atomic write - keep the extension in the temp file so FFmpeg can detect the output format
  const tmpPath = outputPath.replace(/\.[^/.]+$/, "") + ".tmp" + path.extname(outputPath);
  try { fs.unlinkSync(outputPath + ".ready"); } catch {}
  try { fs.unlinkSync(tmpPath); } catch {}
  try { fs.unlinkSync(outputPath); } catch {}

  // Verify font file exists, fallback if not
  const fontEntry = FONT_MAP[config.fontFamily] || FONT_MAP["Montserrat-Black"];
  let fontFile = path.join(fontsDir, fontEntry.file);
  if (!fs.existsSync(fontFile)) {
    console.warn("[FFmpeg Renderer] Font not found: " + fontEntry.file + ", falling back to " + FALLBACK_FONT_FILE);
    fontFile = path.join(fontsDir, FALLBACK_FONT_FILE);
  }
  console.log("[FFmpeg Renderer] Using font: " + fontFile);

  // Generate ASS subtitle file
  const assContent = generateASS(words, config);
  const ts = Date.now();
  const assPath = "/tmp/overlay_" + ts + ".ass";
  fs.writeFileSync(assPath, assContent, "utf-8");

  // Log the first dialogue line for debugging
  const firstDialogue = assContent.split("\n").find(l => l.startsWith("Dialogue:"));
  console.log("[FFmpeg Renderer] ASS file: " + assPath + " (" + (assContent.length / 1024).toFixed(1) + "KB)");
  console.log("[FFmpeg Renderer] First event: " + (firstDialogue || "NONE").substring(0, 200));

  if (progressFile) {
    try { fs.writeFileSync(progressFile, JSON.stringify({ current: 15, total: 100, percent: 15, status: "rendering" }), "utf-8"); } catch {}
  }

  // Build FFmpeg command using a filtergraph script file to avoid escaping issues
  const bgOpacity = typeof config.bgOpacity === "number" ? config.bgOpacity : 1.0;
  const hasSolidBg = !!config.bgColor &&
    config.bgColor !== "none" &&
    config.bgColor !== "transparent" &&
    config.bgColor !== "null" &&
    bgOpacity >= 0.99;

  const colorVal = (() => {
    if (!!config.bgColor &&
        config.bgColor !== "none" &&
        config.bgColor !== "transparent" &&
        config.bgColor !== "null") {
      const hex = config.bgColor.startsWith("#") ? config.bgColor.slice(1) : config.bgColor;
      const fmt = hex.startsWith("0x") ? hex : "0x" + hex;
      return `${fmt}@${bgOpacity}`;
    }
    return "black@0.0";
  })();

  const lofiFactor = config.lofiFactor || 1;
  const lofiFilter = lofiFactor > 1
    ? `,scale=w=iw/${lofiFactor}:h=ih/${lofiFactor},scale=w=iw:h=ih:flags=neighbor`
    : "";

  const width = config.aspectRatio === "1:1" ? 720 : 720;
  const height = config.aspectRatio === "1:1" ? 720 : 1280;

  // Write filter script to file (avoids all command-line escaping issues)
  const filterScript = "/tmp/overlay_filter_" + ts + ".txt";
  // The filter graph: color source -> ass subtitles -> output
  // For transparent: need format=rgba before ass, then convert to yuva420p
  const filterContent = hasSolidBg
    ? "color=c=" + colorVal + ":s=" + width + "x" + height + ":d=" + duration + ":r=" + FPS + ",ass=" + assPath + ":fontsdir=" + fontsDir + lofiFilter + " [out]"
    : "color=c=" + colorVal + ":s=" + width + "x" + height + ":d=" + duration + ":r=" + FPS + ",format=rgba,ass=" + assPath + ":fontsdir=" + fontsDir + lofiFilter + ",format=yuva420p [out]";
  fs.writeFileSync(filterScript, filterContent, "utf-8");
  console.log("[FFmpeg Renderer] Filter script: " + filterScript);
  console.log("[FFmpeg Renderer] Filter content: " + filterContent);

  const ffmpegArgs = [
    "-y",
    "-filter_complex_script", filterScript,
    "-map", "[out]",
    // CRITICAL: Must use VP9 (libvpx-vp9) for alpha transparency support.
    // VP8 (libvpx) does NOT support alpha channel in Debian's FFmpeg 5.1,
    // which caused overlays to render with an opaque black background.
    "-c:v", hasSolidBg ? "libvpx" : "libvpx-vp9",
    "-f", "webm",
    "-pix_fmt", hasSolidBg ? "yuv420p" : "yuva420p",
    "-auto-alt-ref", "0",
    "-quality", "realtime",
    "-speed", "5",
    "-crf", hasSolidBg ? "20" : "23",
    "-b:v", hasSolidBg ? "4M" : "2M",
    "-t", String(duration),
    tmpPath,
  ];

  console.log("[FFmpeg Renderer] Command: ffmpeg " + ffmpegArgs.join(" "));

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
      if (stderr.length < 50000) stderr += chunk;

      // Parse progress
      const timeMatch = chunk.match(/time=(\d+):(\d+):([\d.]+)/);
      if (timeMatch && progressFile) {
        const t = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseFloat(timeMatch[3]);
        const pct = Math.min(95, Math.round(20 + (t / duration) * 75));
        try { fs.writeFileSync(progressFile, JSON.stringify({ current: pct, total: 100, percent: pct, status: "rendering" }), "utf-8"); } catch {}
      }
    });

    ffmpeg.on("close", (code) => {
      // Cleanup temp files
      try { fs.unlinkSync(assPath); } catch {}
      try { fs.unlinkSync(filterScript); } catch {}

      if (code === 0 && fs.existsSync(tmpPath)) {
        const stat = fs.statSync(tmpPath);
        if (stat.size < 1024) {
          console.error("[FFmpeg Renderer] Output too small (" + stat.size + " bytes)");
          try { fs.unlinkSync(tmpPath); } catch {}
          if (progressFile) {
            try { fs.writeFileSync(progressFile, JSON.stringify({ current: 0, total: 100, percent: 0, status: "failed", error: "Output file too small" }), "utf-8"); } catch {}
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
        console.error("[FFmpeg Renderer] ❌ FAILED with exit code: " + code);
        console.error("[FFmpeg Renderer] ═══ FULL STDERR (" + stderr.length + " bytes) ═══");
        // Log stderr in chunks to avoid log truncation
        const stderrLines = stderr.split("\n");
        for (const line of stderrLines) {
          if (line.trim()) console.error("[FFmpeg STDERR] " + line);
        }
        console.error("[FFmpeg Renderer] ═══ END STDERR ═══");
        try { fs.unlinkSync(tmpPath); } catch {}
        if (progressFile) {
          try { fs.writeFileSync(progressFile, JSON.stringify({ current: 0, total: 100, percent: 0, status: "failed", error: stderr.slice(-500) }), "utf-8"); } catch {}
        }
        reject(new Error("FFmpeg failed with code " + code));
      }
    });

    ffmpeg.on("error", (err) => {
      console.error("[FFmpeg Renderer] ❌ SPAWN ERROR:", err);
      try { fs.unlinkSync(assPath); } catch {}
      try { fs.unlinkSync(filterScript); } catch {}
      try { fs.unlinkSync(tmpPath); } catch {}
      if (progressFile) {
        try { fs.writeFileSync(progressFile, JSON.stringify({ current: 0, total: 100, percent: 0, status: "failed", error: "Spawn error: " + String(err) }), "utf-8"); } catch {}
      }
      reject(err);
    });
  });
}
