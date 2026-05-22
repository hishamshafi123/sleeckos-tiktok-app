import { exec } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

export interface ComposeOptions {
  bgVideoPath: string;         // local path
  audioPath: string;           // local path
  quoteText: string;
  quoteAuthor?: string | null;
  fontFamily: string;
  fontSize: number;
  fontColor: string;
  textCase: string;
  boxColor: string;
  shadowColor: string;
  lineSpacing: number;
  videoLength: number;
  trackStart: number;
  outputPath: string;          // local path
}

const FONT_URLS: Record<string, string> = {
  "Outfit": "https://github.com/google/fonts/raw/main/ofl/outfit/static/Outfit-Bold.ttf",
  "Outfit-Bold": "https://github.com/google/fonts/raw/main/ofl/outfit/static/Outfit-Bold.ttf",
  "Inter": "https://github.com/google/fonts/raw/main/ofl/inter/static/Inter-Bold.ttf",
  "Inter-Bold": "https://github.com/google/fonts/raw/main/ofl/inter/static/Inter-Bold.ttf",
  "Playfair Display": "https://github.com/google/fonts/raw/main/ofl/playfairdisplay/static/PlayfairDisplay-Bold.ttf",
  "PlayfairDisplay-Bold": "https://github.com/google/fonts/raw/main/ofl/playfairdisplay/static/PlayfairDisplay-Bold.ttf",
  "Great Vibes": "https://github.com/google/fonts/raw/main/ofl/greatvibes/GreatVibes-Regular.ttf",
  "GreatVibes-Regular": "https://github.com/google/fonts/raw/main/ofl/greatvibes/GreatVibes-Regular.ttf"
};

/**
 * Checks system font paths or downloads google font if configured, falling back gracefully.
 */
export async function resolveFontPath(fontFamily: string): Promise<string> {
  const fontsDir = path.join(process.cwd(), "public", "fonts");
  if (!fs.existsSync(fontsDir)) {
    fs.mkdirSync(fontsDir, { recursive: true });
  }

  // Check if we have a direct url mapping for this font
  const normalizedKey = fontFamily.trim();
  const url = FONT_URLS[normalizedKey];

  if (url) {
    const fontFileName = `${normalizedKey.replace(/\s+/g, "")}.ttf`;
    const fontFilePath = path.join(fontsDir, fontFileName);

    if (fs.existsSync(fontFilePath)) {
      return fontFilePath;
    }

    try {
      console.log(`[Composer] Downloading font "${fontFamily}" from ${url}...`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8-second download timeout

      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        const buffer = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(fontFilePath, buffer);
        console.log(`[Composer] Cached font at ${fontFilePath}`);
        return fontFilePath;
      }
    } catch (err) {
      console.warn(`[Composer] Font download failed for ${fontFamily}, falling back`, err);
    }
  }

  // Try checking standard local fonts path
  const localPath = path.join(fontsDir, `${fontFamily}.ttf`);
  if (fs.existsSync(localPath)) {
    return localPath;
  }

  // Get system fallback paths
  const fallbacks = [
    "/usr/share/fonts/ttf-dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
    "/Library/Fonts/Arial.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf"
  ];

  for (const p of fallbacks) {
    if (fs.existsSync(p)) {
      console.log(`[Composer] Using fallback system font: ${p}`);
      return p;
    }
  }

  return "Arial"; // let ffmpeg try internal system font resolver
}

/**
 * Formats casing according to config settings
 */
function applyCasing(text: string, casing: string): string {
  const c = casing.trim().toLowerCase();
  if (c === "uppercase") {
    return text.toUpperCase();
  }
  if (c === "lowercase") {
    return text.toLowerCase();
  }
  if (c === "capitalize" || c === "title case") {
    return text.replace(/\b\w/g, char => char.toUpperCase());
  }
  return text;
}

/**
 * Splits text into lines of roughly maxChars length without cutting words.
 */
export function wrapText(text: string, maxCharsPerLine: number = 25): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if ((currentLine + " " + word).trim().length <= maxCharsPerLine) {
      currentLine = currentLine ? currentLine + " " + word : word;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);

  return lines.join("\n");
}

/**
 * Standardizes colors to FFmpeg compliant values.
 * Handles hex codes (#ffffff -> 0xffffff) and opacity syntax (black@0.4 -> black@0.4).
 */
function formatFfmpegColor(colorStr: string): string {
  const trimmed = colorStr.trim();
  if (trimmed.includes("@") || trimmed.startsWith("0x")) {
    return trimmed;
  }
  if (trimmed.startsWith("#")) {
    return "0x" + trimmed.slice(1);
  }
  return trimmed;
}

/**
 * Composes a premium vertical TikTok quote video using server-side FFmpeg.
 * Includes loop background, crop to 9:16, custom fonts, fading animations, and audio cross-fades.
 */
export async function composeVideo(options: ComposeOptions): Promise<string> {
  const {
    bgVideoPath,
    audioPath,
    quoteText,
    quoteAuthor,
    fontFamily,
    fontSize,
    fontColor,
    textCase,
    boxColor,
    shadowColor,
    lineSpacing,
    videoLength,
    trackStart,
    outputPath
  } = options;

  // 1. Resolve font path
  const resolvedFont = await resolveFontPath(fontFamily);

  // 2. Format quote text and wrapping
  const casedText = applyCasing(quoteText, textCase);
  const wrappedText = wrapText(casedText, 25);
  
  let fullText = wrappedText;
  if (quoteAuthor) {
    fullText += `\n\n— ${quoteAuthor.trim()}`;
  }

  // Create temporary text file to hold the quote
  const tempDir = path.join(process.cwd(), "temp_renders");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  const textFilePath = path.join(tempDir, `quote_${Math.random().toString(36).substring(2, 9)}.txt`);
  fs.writeFileSync(textFilePath, fullText);

  // 3. Format colors for FFmpeg
  const drawFontColor = formatFfmpegColor(fontColor);
  
  // Format box color
  let drawBoxStr = "";
  if (boxColor && boxColor.toLowerCase() !== "none") {
    const drawBoxColor = formatFfmpegColor(boxColor);
    drawBoxStr = `:box=1:boxcolor=${drawBoxColor}:boxborderw=20`;
  }

  // Format shadow color
  let drawShadowStr = "";
  if (shadowColor && shadowColor.toLowerCase() !== "none") {
    const drawShadowColor = formatFfmpegColor(shadowColor);
    drawShadowStr = `:shadowcolor=${drawShadowColor}:shadowx=2:shadowy=2`;
  }

  // Calculate audio fade start (fade out for last 1 second)
  const fadeStart = Math.max(0, videoLength - 1.0);

  // FFmpeg drawtext font config escaping
  // On Windows/Darwin, path backslashes must be escaped for FFmpeg drawtext
  const escapedFontPath = resolvedFont.replace(/\\/g, "/").replace(/:/g, "\\:");
  const escapedTextFilePath = textFilePath.replace(/\\/g, "/").replace(/:/g, "\\:");

  return new Promise((resolve, reject) => {
    // Construct single-pass FFmpeg command
    // Loops background infinitely, crops/scales to 9:16 720x1280, overlay text box, fading in first 0.5s & out last 0.5s
    const cmd = [
      "ffmpeg",
      "-y",
      "-stream_loop -1",
      `-i "${bgVideoPath}"`,
      `-ss ${trackStart}`,
      `-t ${videoLength}`,
      `-i "${audioPath}"`,
      "-filter_complex",
      `"[0:v]scale='if(gte(iw/ih,720/1280),-1,720)':'if(gte(iw/ih,720/1280),1280,-1)',crop=720:1280,drawtext=fontfile='${escapedFontPath}':textfile='${escapedTextFilePath}':fontcolor=${drawFontColor}:fontsize=${fontSize}:x=(w-text_w)/2:y=(h-text_h)/2:line_spacing=${lineSpacing}${drawBoxStr}${drawShadowStr}:alpha='if(lt(t,0.5),t/0.5,if(gt(t,${videoLength}-0.5),(${videoLength}-t)/0.5,1))'[v];[1:a]afade=t=out:st=${fadeStart}:d=1[a]"`,
      '-map "[v]"',
      '-map "[a]"',
      "-c:v libx264",
      "-pix_fmt yuv420p",
      "-preset superfast",
      "-c:a aac",
      `-t ${videoLength}`,
      `"${outputPath}"`
    ].join(" ");

    console.log(`[Composer] Spawning FFmpeg command: ${cmd}`);

    exec(cmd, (error, stdout, stderr) => {
      // Always cleanup the temporary text file
      try {
        if (fs.existsSync(textFilePath)) {
          fs.unlinkSync(textFilePath);
        }
      } catch (err) {
        console.error("[Composer] Failed to cleanup temp text file", err);
      }

      if (error) {
        console.error("[Composer] FFmpeg execution error:", stderr);
        return reject(new Error(`FFmpeg failed: ${error.message}. Stderr: ${stderr}`));
      }

      console.log(`[Composer] Rendering completed successfully: ${outputPath}`);
      resolve(outputPath);
    });
  });
}

/**
 * Query Gemini API for count unique quotes matching theme, checking for duplicates.
 */
export async function generateQuotesForTheme(
  theme: string,
  count: number,
  existingQuotes: string[]
): Promise<{ text: string; author: string | null }[]> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.YOUTUBE_API_KEY;
  
  if (!apiKey) {
    console.warn("[Composer] GEMINI_API_KEY not found. Using high-quality motivational fallback quotes.");
    return generateFallbackQuotes(theme, count);
  }

  const prompt = [
    "You are a professional creative writer specializing in premium TikTok quotes.",
    `Generate exactly ${count} unique, high-quality, short, and highly impactful quotes for this sub-niche/theme:`,
    `"${theme}"`,
    "",
    "Rules:",
    "1. Each quote must be inspiring, deeply motivational, or highly engaging.",
    "2. Each quote must be extremely concise (maximum 15-20 words), perfect for visual vertical video slides.",
    "3. Keep quotes extremely clean, simple, and elegant.",
    "4. Optional but recommended: provide an author for each quote (e.g., Seneca, Anonymous, Unknown) only if it fits the style.",
    "5. CRITICAL: Completely avoid repeating or mimicking the following quotes which were generated previously:",
    ...existingQuotes.slice(-40).map(q => `- "${q}"`),
    "",
    "Respond ONLY with a valid JSON array of objects containing 'text' and 'author' (which can be a string or null).",
    "Do NOT wrap the JSON output in markdown blocks like ```json. Return only the raw JSON string.",
    "Example format:",
    '[{"text": "The only way out is through.", "author": "Robert Frost"}, {"text": "Do not seek to have events happen as you want them to.", "author": "Epictetus"}]'
  ].join("\n");

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 1000, temperature: 0.8 }
        }),
        signal: controller.signal
      }
    );

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Gemini API returned status ${res.status}`);
    }

    const data = await res.json();
    const rawAiOutput = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (rawAiOutput) {
      let cleanText = rawAiOutput;
      if (cleanText.startsWith("```")) {
        cleanText = cleanText.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
      }

      const quotes = JSON.parse(cleanText);
      if (Array.isArray(quotes)) {
        return quotes.map((q: any) => ({
          text: String(q.text || q.quote || "").trim(),
          author: q.author ? String(q.author).trim() : null
        })).filter(q => q.text.length > 0);
      }
    }
  } catch (err) {
    console.error("[Composer] Failed to generate AI quotes, falling back to local fallback repository:", err);
  }

  return generateFallbackQuotes(theme, count);
}

/**
 * Clean fallback motivational generator if Gemini API is offline or key is missing.
 */
function generateFallbackQuotes(theme: string, count: number): { text: string; author: string | null }[] {
  const list = [
    { text: "The obstacles you face are the path to your destiny.", author: "Marcus Aurelius" },
    { text: "He who has a why to live can bear almost any how.", author: "Friedrich Nietzsche" },
    { text: "Difficulty is what wakes up the creative sleeping giant.", author: "Anonymous" },
    { text: "Your potential is limited only by the boundaries of your imagination.", author: "Unknown" },
    { text: "Control your mind, or it will control you.", author: "Horace" },
    { text: "Waste no more time arguing about what a good man should be. Be one.", author: "Marcus Aurelius" },
    { text: "Quiet minds cannot be perplexed or frightened.", author: "Seneca" },
    { text: "The happiness of your life depends upon the quality of your thoughts.", author: "Marcus Aurelius" },
    { text: "Do not explain your philosophy. Embody it.", author: "Epictetus" },
    { text: "We suffer more often in imagination than in reality.", author: "Seneca" },
    { text: "Begin at once to live, and count each separate day as a separate life.", author: "Seneca" },
    { text: "No man is free who is not master of himself.", author: "Epictetus" }
  ];

  // Shuffle and return count items
  const shuffled = [...list].sort(() => 0.5 - Math.random());
  const result: { text: string; author: string | null }[] = [];
  for (let i = 0; i < count; i++) {
    result.push(shuffled[i % shuffled.length]);
  }
  return result;
}

/**
 * Distributes pool of audio tracks round-robin style avoiding over-reusing any track per account.
 */
export function allocateTracks(
  itemsCount: number,
  tracks: { id: string }[],
  maxReuse: number
): { trackId: string }[] {
  if (tracks.length === 0) {
    throw new Error("No tracks available in the pool to allocate");
  }

  const allocation: { trackId: string }[] = [];
  const trackUsage: Record<string, number> = {};
  for (const track of tracks) {
    trackUsage[track.id] = 0;
  }

  let trackIndex = 0;
  for (let i = 0; i < itemsCount; i++) {
    let selectedTrackId = "";
    let checkedCount = 0;

    // Search for a track that hasn't exceeded the maxReuse threshold
    while (checkedCount < tracks.length) {
      const track = tracks[trackIndex];
      if (trackUsage[track.id] < maxReuse) {
        selectedTrackId = track.id;
        trackUsage[track.id]++;
        trackIndex = (trackIndex + 1) % tracks.length;
        break;
      }
      trackIndex = (trackIndex + 1) % tracks.length;
      checkedCount++;
    }

    // Fallback: If all tracks have reached maxReuse limit, reset usage counters and force allocation
    if (!selectedTrackId) {
      for (const track of tracks) {
        trackUsage[track.id] = 0;
      }
      const track = tracks[trackIndex];
      selectedTrackId = track.id;
      trackUsage[track.id]++;
      trackIndex = (trackIndex + 1) % tracks.length;
    }

    allocation.push({ trackId: selectedTrackId });
  }

  return allocation;
}
