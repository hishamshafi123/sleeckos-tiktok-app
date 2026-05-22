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
  curveText?: boolean;
  curvature?: number;
  positionY?: number;
}

const FONT_URLS: Record<string, string> = {
  "Outfit": "https://github.com/google/fonts/raw/main/ofl/outfit/static/Outfit-Bold.ttf",
  "Outfit-Bold": "https://github.com/google/fonts/raw/main/ofl/outfit/static/Outfit-Bold.ttf",
  "Inter": "https://github.com/google/fonts/raw/main/ofl/inter/static/Inter-Bold.ttf",
  "Inter-Bold": "https://github.com/google/fonts/raw/main/ofl/inter/static/Inter-Bold.ttf",
  "Playfair Display": "https://github.com/google/fonts/raw/main/ofl/playfairdisplay/static/PlayfairDisplay-Bold.ttf",
  "PlayfairDisplay-Bold": "https://github.com/google/fonts/raw/main/ofl/playfairdisplay/static/PlayfairDisplay-Bold.ttf",
  "Great Vibes": "https://github.com/google/fonts/raw/main/ofl/greatvibes/GreatVibes-Regular.ttf",
  "GreatVibes-Regular": "https://github.com/google/fonts/raw/main/ofl/greatvibes/GreatVibes-Regular.ttf",
  "Anton": "https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf",
  "Anton-Regular": "https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf",
  "Oswald": "https://github.com/google/fonts/raw/main/ofl/oswald/static/Oswald-Bold.ttf",
  "Oswald-Bold": "https://github.com/google/fonts/raw/main/ofl/oswald/static/Oswald-Bold.ttf",
  "Montserrat": "https://github.com/google/fonts/raw/main/ofl/montserrat/static/Montserrat-Bold.ttf",
  "Montserrat-Bold": "https://github.com/google/fonts/raw/main/ofl/montserrat/static/Montserrat-Bold.ttf",
  "Caveat": "https://github.com/google/fonts/raw/main/ofl/caveat/static/Caveat-Bold.ttf",
  "Caveat-Bold": "https://github.com/google/fonts/raw/main/ofl/caveat/static/Caveat-Bold.ttf",
  "Lora": "https://github.com/google/fonts/raw/main/ofl/lora/static/Lora-Bold.ttf",
  "Lora-Bold": "https://github.com/google/fonts/raw/main/ofl/lora/static/Lora-Bold.ttf"
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
    outputPath,
    curveText = false,
    curvature = 30,
    positionY = 50
  } = options;

  // 1. Resolve font path
  const resolvedFont = await resolveFontPath(fontFamily);
  const tempDir = path.join(process.cwd(), "temp_renders");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // Calculate audio fade start (fade out for last 1 second)
  const fadeStart = Math.max(0, videoLength - 1.0);

  let filterComplex = "";
  let textFilePath = "";
  let svgFilePath = "";

  if (curveText) {
    // True curved text along an SVG path
    const casedText = applyCasing(quoteText, textCase);
    const displayQuote = casedText.trim();
    const posPercent = Math.min(Math.max(10, positionY), 90);

    // Proportionally scale standard 9:16 coordinates to 720x1280 resolution
    const yBase = Math.round((1280 * posPercent) / 100);
    const startX = 60;
    const endX = 660;
    const startY = yBase;
    const endY = yBase;
    const controlX = 360;
    // Multiplier adjusted for pleasant curvature visual match
    const controlY = yBase - (curvature * 2.5);

    const isTransparent = !boxColor || boxColor.toLowerCase() === "none";
    let rectSvg = "";

    if (!isTransparent) {
      let boxColorHex = "#000000";
      let boxAlpha = 0.4;
      const parts = boxColor.split("@");
      if (parts.length === 2) {
        boxColorHex = parts[0];
        const parsedAlpha = parseFloat(parts[1]);
        if (!isNaN(parsedAlpha)) {
          boxAlpha = parsedAlpha;
        }
      } else {
        boxColorHex = boxColor;
        boxAlpha = 1.0;
      }
      
      const cardW = 640;
      // Curved text cards can have standard visual boundaries
      const cardH = Math.round(fontSize * 2 + 120);
      const cardX = 40;
      const cardY = Math.round(yBase - cardH / 2 - 20);
      rectSvg = `<rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="24" ry="24" fill="${boxColorHex}" fill-opacity="${boxAlpha}" />`;
    }

    let filterDefSvg = "";
    let filterAttrSvg = "";
    if (shadowColor && shadowColor.toLowerCase() !== "none") {
      let shadowColorHex = "black";
      let shadowAlpha = 0.6;
      const parts = shadowColor.split("@");
      if (parts.length === 2) {
        shadowColorHex = parts[0];
        const parsedAlpha = parseFloat(parts[1]);
        if (!isNaN(parsedAlpha)) {
          shadowAlpha = parsedAlpha;
        }
      } else {
        shadowColorHex = shadowColor;
        shadowAlpha = 1.0;
      }
      filterDefSvg = `
    <filter id="shadowFilter" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="2" dy="2" stdDeviation="3" flood-color="${shadowColorHex}" flood-opacity="${shadowAlpha}" />
    </filter>
      `;
      filterAttrSvg = `filter="url(#shadowFilter)"`;
    }

    const svgFileName = `quote_${Math.random().toString(36).substring(2, 9)}.svg`;
    svgFilePath = path.join(tempDir, svgFileName);

    // Format absolute path for local font rendering inside rsvg
    const formattedFontUrl = resolvedFont.replace(/\\/g, "/");

    const svgContent = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 1280" width="720" height="1280">
  <defs>
    ${filterDefSvg}
  </defs>
  <style>
    @font-face {
      font-family: 'StoicFont';
      src: url('file://${formattedFontUrl}');
    }
    .quote-text {
      font-family: 'StoicFont', 'Arial', sans-serif;
      font-size: ${fontSize}px;
      font-weight: bold;
      fill: ${fontColor};
      text-anchor: middle;
      letter-spacing: 1px;
    }
    .author-text {
      font-family: 'StoicFont', 'Arial', sans-serif;
      font-size: ${Math.round(fontSize * 0.6)}px;
      font-weight: 500;
      fill: ${fontColor};
      text-anchor: middle;
      opacity: 0.8;
    }
  </style>
  ${rectSvg}
  <path id="curvePath" d="M ${startX} ${startY} Q ${controlX} ${controlY} ${endX} ${endY}" fill="none" stroke="none" />
  <text class="quote-text" ${filterAttrSvg}>
    <textPath href="#curvePath" startOffset="50%">
      ${displayQuote}
    </textPath>
  </text>
  ${quoteAuthor && quoteAuthor.trim() ? `<text x="360" y="${yBase + Math.round(fontSize + 30)}" class="author-text" ${filterAttrSvg}>— ${quoteAuthor.trim()}</text>` : ''}
</svg>
`.trim();

    fs.writeFileSync(svgFilePath, svgContent);

    // Build the filter complex overlaying the SVG onto scaled/cropped background
    filterComplex = [
      `[0:v]scale='if(gte(iw/ih,720/1280),-1,720)':'if(gte(iw/ih,720/1280),1280,-1)',crop=720:1280[bg]`,
      `[2:v]format=yuva420p,fade=in:st=0:d=0.5:alpha=1,fade=out:st=${fadeStart}:d=0.5:alpha=1[v_overlay]`,
      `[bg][v_overlay]overlay=x=0:y=0[v]`,
      `[1:a]afade=t=out:st=${fadeStart}:d=1[a]`
    ].join(";");

  } else {
    // Standard horizontal text using drawtext file rendering
    const casedText = applyCasing(quoteText, textCase);
    const wrappedText = wrapText(casedText, 25);
    
    let fullText = wrappedText;
    if (quoteAuthor && quoteAuthor.trim()) {
      fullText += `\n\n— ${quoteAuthor.trim()}`;
    }

    textFilePath = path.join(tempDir, `quote_${Math.random().toString(36).substring(2, 9)}.txt`);
    fs.writeFileSync(textFilePath, fullText);

    const drawFontColor = formatFfmpegColor(fontColor);
    
    // Format box color
    const isTransparent = !boxColor || boxColor.toLowerCase() === "none";
    let drawBoxStr = "";
    if (!isTransparent) {
      const drawBoxColor = formatFfmpegColor(boxColor);
      drawBoxStr = `:box=1:boxcolor=${drawBoxColor}:boxborderw=20`;
    }

    // Format shadow color
    let drawShadowStr = "";
    if (shadowColor && shadowColor.toLowerCase() !== "none") {
      const drawShadowColor = formatFfmpegColor(shadowColor);
      drawShadowStr = `:shadowcolor=${drawShadowColor}:shadowx=2:shadowy=2`;
    }

    const escapedFontPath = resolvedFont.replace(/\\/g, "/").replace(/:/g, "\\:");
    const escapedTextFilePath = textFilePath.replace(/\\/g, "/").replace(/:/g, "\\:");
    const posPercent = Math.min(Math.max(10, positionY), 90);

    filterComplex = [
      `[0:v]scale='if(gte(iw/ih,720/1280),-1,720)':'if(gte(iw/ih,720/1280),1280,-1)',crop=720:1280,drawtext=fontfile='${escapedFontPath}':textfile='${escapedTextFilePath}':fontcolor=${drawFontColor}:fontsize=${fontSize}:x=(w-text_w)/2:y=((h-text_h)*${posPercent}/100):line_spacing=${lineSpacing}${drawBoxStr}${drawShadowStr}:alpha='if(lt(t,0.5),t/0.5,if(gt(t,${videoLength}-0.5),(${videoLength}-t)/0.5,1))'[v]`,
      `[1:a]afade=t=out:st=${fadeStart}:d=1[a]`
    ].join(";");
  }

  return new Promise((resolve, reject) => {
    // Construct single-pass FFmpeg command
    const cmd = [
      "ffmpeg",
      "-y",
      "-loglevel error",
      "-stream_loop -1",
      `-i "${bgVideoPath}"`,
      `-ss ${trackStart}`,
      `-t ${videoLength}`,
      `-i "${audioPath}"`,
      ...(curveText ? [`-i "${svgFilePath}"`] : []),
      "-filter_complex",
      `"${filterComplex}"`,
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

    exec(cmd, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      // Always cleanup temporary files
      try {
        if (textFilePath && fs.existsSync(textFilePath)) {
          fs.unlinkSync(textFilePath);
        }
      } catch (err) {
        console.error("[Composer] Failed to cleanup temp text file", err);
      }

      try {
        if (svgFilePath && fs.existsSync(svgFilePath)) {
          fs.unlinkSync(svgFilePath);
        }
      } catch (err) {
        console.error("[Composer] Failed to cleanup temp SVG file", err);
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

  // Overshoot strategy to generate excess quotes to filter duplicates
  const targetCount = Math.max(count * 2, count + 10);

  // Normalize existing quotes cache for case-insensitive lookup
  const normalizedCache = new Set(existingQuotes.map(q => q.trim().toLowerCase()).filter(Boolean));

  // Use the last 150 historical quotes as a negative prompt seed to Gemini
  const negativeSeeds = existingQuotes.slice(-150).map(q => q.trim()).filter(Boolean);

  const prompt = [
    "You are a professional creative writer specializing in premium TikTok quotes.",
    `Generate exactly ${targetCount} unique, high-quality, short, and highly impactful quotes for this sub-niche/theme:`,
    `"${theme}"`,
    "",
    "Rules:",
    "1. Each quote must be inspiring, deeply motivational, or highly engaging.",
    "2. Each quote must be extremely concise (maximum 15-20 words), perfect for visual vertical video slides.",
    "3. Keep quotes extremely clean, simple, and elegant.",
    "4. CRITICAL: Do NOT generate or include any author name, author attribution, or signature placeholder (e.g. do NOT include names like 'Seneca', 'Anonymous', 'Unknown', etc. inside the quote text or as a field).",
    "5. CRITICAL: Completely avoid repeating or mimicking the following quotes which were generated previously:",
    ...negativeSeeds.map(q => `- "${q}"`),
    "",
    "Respond ONLY with a valid JSON array of objects, where each object has ONLY a 'text' key.",
    "Do NOT wrap the JSON output in markdown blocks like ```json. Return only the raw JSON string.",
    "Example format:",
    '[{"text": "The only way out is through."}, {"text": "Do not seek to have events happen as you want them to."}]'
  ].join("\n");

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 2000, temperature: 0.8 }
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

      const parsedQuotes = JSON.parse(cleanText);
      if (Array.isArray(parsedQuotes)) {
        const uniqueFiltered: { text: string; author: string | null }[] = [];
        const seenInBatch = new Set<string>();

        for (const q of parsedQuotes) {
          const text = String(q.text || q.quote || "").trim();
          if (!text) continue;

          const lowerText = text.toLowerCase();
          
          if (!normalizedCache.has(lowerText) && !seenInBatch.has(lowerText)) {
            seenInBatch.add(lowerText);
            uniqueFiltered.push({
              text,
              author: null
            });
          }
        }

        console.log(`[Composer] Generated ${uniqueFiltered.length} unique quotes out of ${parsedQuotes.length} returned by Gemini. Requested ${count}.`);

        if (uniqueFiltered.length >= count) {
          return uniqueFiltered.slice(0, count);
        }

        // Pad with fallbacks if short of unique quotes
        const fallbacks = generateFallbackQuotes(theme, count - uniqueFiltered.length);
        return [...uniqueFiltered, ...fallbacks];
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
    { text: "The obstacles you face are the path to your destiny.", author: null },
    { text: "He who has a why to live can bear almost any how.", author: null },
    { text: "Difficulty is what wakes up the creative sleeping giant.", author: null },
    { text: "Your potential is limited only by the boundaries of your imagination.", author: null },
    { text: "Control your mind, or it will control you.", author: null },
    { text: "Waste no more time arguing about what a good man should be. Be one.", author: null },
    { text: "Quiet minds cannot be perplexed or frightened.", author: null },
    { text: "The happiness of your life depends upon the quality of your thoughts.", author: null },
    { text: "Do not explain your philosophy. Embody it.", author: null },
    { text: "We suffer more often in imagination than in reality.", author: null },
    { text: "Begin at once to live, and count each separate day as a separate life.", author: null },
    { text: "No man is free who is not master of himself.", author: null }
  ];

  // Shuffle and return count items
  const shuffled = [...list].sort(() => 0.5 - Math.random());
  const result: { text: string; author: string | null }[] = [];
  for (let i = 0; i < count; i++) {
    result.push({
      text: shuffled[i % shuffled.length].text,
      author: null
    });
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
