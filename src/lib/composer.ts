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

/**
 * Weight-specific static font files from Google Fonts CDN (fonts.gstatic.com/s/).
 * These are single-weight TTF files (26KB–112KB), NOT variable fonts.
 * Verified: all Bold entries are usWeightClass=700, no fvar table, valid TrueType headers.
 * 
 * CRITICAL: Do NOT replace these with GitHub variable fonts (Outfit[wght].ttf etc.)
 * — those have fvar tables and default to weight 100 (Thin) in FFmpeg's drawtext,
 * because FFmpeg cannot select a weight axis from variable fonts.
 * 
 * Fonts are also baked into the Docker image at build time (see Dockerfile).
 */
const FONT_URLS: Record<string, string> = {
  "Outfit": "https://fonts.gstatic.com/s/outfit/v15/QGYyz_MVcBeNP4NjuGObqx1XmO1I4deyO4a0Fg.ttf",
  "Outfit-Bold": "https://fonts.gstatic.com/s/outfit/v15/QGYyz_MVcBeNP4NjuGObqx1XmO1I4deyO4a0Fg.ttf",
  "Inter": "https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYAZ9hjQ.ttf",
  "Inter-Bold": "https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYAZ9hjQ.ttf",
  "Playfair Display": "https://fonts.gstatic.com/s/playfairdisplay/v40/nuFvD-vYSZviVYUb_rj3ij__anPXJzDwcbmjWBN2PKeiunDXbtY.ttf",
  "PlayfairDisplay-Bold": "https://fonts.gstatic.com/s/playfairdisplay/v40/nuFvD-vYSZviVYUb_rj3ij__anPXJzDwcbmjWBN2PKeiunDXbtY.ttf",
  "Great Vibes": "https://fonts.gstatic.com/s/greatvibes/v21/RWmMoKWR9v4ksMfaWd_JN9XFiaE.ttf",
  "GreatVibes-Regular": "https://fonts.gstatic.com/s/greatvibes/v21/RWmMoKWR9v4ksMfaWd_JN9XFiaE.ttf",
  "Anton": "https://fonts.gstatic.com/s/anton/v27/1Ptgg87LROyAm3Kz-Co.ttf",
  "Anton-Regular": "https://fonts.gstatic.com/s/anton/v27/1Ptgg87LROyAm3Kz-Co.ttf",
  "Oswald": "https://fonts.gstatic.com/s/oswald/v57/TK3_WkUHHAIjg75cFRf3bXL8LICs1xZosUZiYA.ttf",
  "Oswald-Bold": "https://fonts.gstatic.com/s/oswald/v57/TK3_WkUHHAIjg75cFRf3bXL8LICs1xZosUZiYA.ttf",
  "Montserrat": "https://fonts.gstatic.com/s/montserrat/v31/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCuM73w5aX8.ttf",
  "Montserrat-Bold": "https://fonts.gstatic.com/s/montserrat/v31/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCuM73w5aX8.ttf",
  "Caveat": "https://fonts.gstatic.com/s/caveat/v23/WnznHAc5bAfYB2QRah7pcpNvOx-pjRV6eIWpZA.ttf",
  "Caveat-Bold": "https://fonts.gstatic.com/s/caveat/v23/WnznHAc5bAfYB2QRah7pcpNvOx-pjRV6eIWpZA.ttf",
  "Lora": "https://fonts.gstatic.com/s/lora/v37/0QI6MX1D_JOuGQbT0gvTJPa787z5vBJBkqg.ttf",
  "Lora-Bold": "https://fonts.gstatic.com/s/lora/v37/0QI6MX1D_JOuGQbT0gvTJPa787z5vBJBkqg.ttf"
};

/** Minimum valid font file size — anything smaller is a corrupt cache artifact */
const MIN_FONT_SIZE_BYTES = 5_000;

/** Valid TrueType magic bytes: 0x00010000 (TrueType) or 0x4F54544F ('OTTO' = OpenType) */
function isValidTTF(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, "r");
    const header = Buffer.alloc(4);
    fs.readSync(fd, header, 0, 4, 0);
    fs.closeSync(fd);
    const magic = header.readUInt32BE(0);
    return magic === 0x00010000 || magic === 0x4F54544F;
  } catch {
    return false;
  }
}

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

    // Validate cached font: must exist, be large enough, and have valid TTF header
    if (fs.existsSync(fontFilePath)) {
      try {
        const stats = fs.statSync(fontFilePath);
        if (stats.size >= MIN_FONT_SIZE_BYTES && isValidTTF(fontFilePath)) {
          return fontFilePath;
        }
        console.warn(`[Composer] Cached font at ${fontFilePath} is invalid (${stats.size} bytes, validTTF=${isValidTTF(fontFilePath)}). Deleting stale cache...`);
        fs.unlinkSync(fontFilePath);
      } catch (err) {
        console.warn(`[Composer] Failed to validate cached font file:`, err);
      }
    }

    try {
      console.log(`[Composer] Downloading font "${fontFamily}" from ${url}...`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15-second download timeout (GitHub raw can be slow)

      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length >= MIN_FONT_SIZE_BYTES) {
          fs.writeFileSync(fontFilePath, buffer);
          console.log(`[Composer] Cached font at ${fontFilePath} (${buffer.length} bytes)`);
          return fontFilePath;
        } else {
          console.warn(`[Composer] Downloaded font is too small (${buffer.length} bytes), skipping cache`);
        }
      } else {
        console.warn(`[Composer] Font download returned HTTP ${res.status} for ${fontFamily}`);
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
 * Sanitizes quote text from Gemini API output or user input.
 * Strips carriage returns, control characters, invisible formatting chars,
 * and problematic unicode symbols that FFmpeg renders as box glyphs.
 */
function sanitizeQuoteText(text: string): string {
  return text
    // Strip carriage returns
    .replace(/\r/g, "")
    // Strip all ASCII control characters except newline (\n = 0x0A)
    .replace(/[\x00-\x09\x0B-\x1F\x7F]/g, "")
    // Strip invisible formatting / zero-width characters
    .replace(/[\u00AD\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060\uFEFF]/g, "")
    // Strip NOT SIGN (¬ U+00AC) and REVERSED NOT SIGN (⌐ U+2310) — common Gemini artifacts
    .replace(/[\u00AC\u2310]/g, "")
    // Strip box-drawing / misc symbols that FFmpeg can't render
    .replace(/[\u2500-\u257F\u2580-\u259F\u25A0-\u25FF]/g, "")
    // Normalize ALL smart/curly quote variants to straight quotes
    // Single quotes: U+2018 ' U+2019 ' U+201A ‚ U+201B ‛ U+2032 ′ U+02BC ʼ U+FF07 '
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u02BC\uFF07]/g, "'")
    // Double quotes: U+201C " U+201D " U+201E „ U+201F ‟ U+2033 ″ U+FF02 "
    .replace(/[\u201C\u201D\u201E\u201F\u2033\uFF02]/g, '"')
    // Normalize em/en dashes and horizontal bar to simple dash
    .replace(/[\u2013\u2014\u2015]/g, "-")
    // Normalize ellipsis character to three dots
    .replace(/\u2026/g, "...")
    // Normalize bullet and middle dot to dash
    .replace(/[\u2022\u2023\u25E6\u00B7]/g, "-")
    // Normalize non-breaking space and other space variants to regular space
    .replace(/[\u00A0\u2002-\u200A\u205F\u3000]/g, " ")
    // Final safety net: strip any remaining characters outside basic printable ASCII + common Latin
    // Keep: space (0x20) through tilde (0x7E), newline (0x0A), and Latin-1 Supplement letters (0xC0-0xFF)
    .replace(/[^\x0A\x20-\x7E\u00C0-\u00FF]/g, "")
    .trim();
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
  // Strip all carriage returns
  const cleanText = text.replace(/\r/g, "");
  
  // Split on newlines to preserve manual line breaks
  const rawLines = cleanText.split("\n");
  const finalLines: string[] = [];

  for (const rawLine of rawLines) {
    const words = rawLine.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      finalLines.push(""); // preserve empty lines
      continue;
    }

    let currentLine = "";
    for (const word of words) {
      if ((currentLine + " " + word).trim().length <= maxCharsPerLine) {
        currentLine = currentLine ? currentLine + " " + word : word;
      } else {
        if (currentLine) finalLines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) finalLines.push(currentLine);
  }

  return finalLines.join("\n");
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
  const tempDir = path.join(os.tmpdir(), "temp_renders");
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
    const cleanQuote = sanitizeQuoteText(quoteText);
    const casedText = applyCasing(cleanQuote, textCase);
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
    const cleanQuote = sanitizeQuoteText(quoteText);
    const casedText = applyCasing(cleanQuote, textCase);
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

// ══════════════════════════════════════════════════════════════════════════════
// Video Multiplier Composer — Overlay text hook on a colored strip
// ══════════════════════════════════════════════════════════════════════════════

export interface MultiplierComposeOptions {
  inputVideoPath: string;
  hookText: string;
  fontFamily: string;
  fontSize: number;
  fontColor: string;
  textCase: string;
  bgStripColor: string;
  bgStripOpacity: number;
  textPosition: "TOP" | "BOTTOM";
  stripPaddingY: number;
  positionYPercent: number;
  marginX: number;
  borderRadius: number;
  outputPath: string;
}

export async function composeMultiplierVideo(options: MultiplierComposeOptions): Promise<string> {
  const {
    inputVideoPath, hookText, fontFamily, fontSize, fontColor, textCase,
    bgStripColor, bgStripOpacity, stripPaddingY, positionYPercent,
    marginX, borderRadius, outputPath,
  } = options;

  const OUTPUT_W = 720;
  const OUTPUT_H = 1280;

  const resolvedFont = await resolveFontPath(fontFamily);
  const escapedFontPath = resolvedFont.replace(/\\/g, "/").replace(/:/g, "\\:");

  const cleanText = sanitizeQuoteText(hookText);
  const casedText = applyCasing(cleanText, textCase);

  const tempDir = path.join(os.tmpdir(), "temp_multiplier");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  // Use stripPaddingY as uniform inner padding (horizontal + vertical)
  const paddingX = Math.max(stripPaddingY, 16); // Ensure at least 16px inner horizontal padding
  const effectiveTextWidth = OUTPUT_W - marginX * 2 - paddingX * 2;
  const charsPerLine = Math.max(10, Math.floor(effectiveTextWidth / (fontSize * 0.62)));
  const wrappedText = wrapText(casedText, charsPerLine);
  const textFilePath = path.join(tempDir, "hook_" + Math.random().toString(36).substring(2, 9) + ".txt");
  fs.writeFileSync(textFilePath, wrappedText);
  const escapedTextFilePath = textFilePath.replace(/\\/g, "/").replace(/:/g, "\\:");

  const drawFontColor = formatFfmpegColor(fontColor);

  const lineCount = wrappedText.split("\n").length;
  const lineHeight = fontSize * 1.4;
  const stripHeight = Math.round(lineCount * lineHeight + stripPaddingY * 2 + 10);
  const yPercent = Math.max(0, Math.min(100, positionYPercent));
  const maxY = OUTPUT_H - stripHeight;
  const stripY = Math.round((maxY * yPercent) / 100);
  const textY = stripY + stripPaddingY;
  const stripX = marginX;
  const stripW = OUTPUT_W - marginX * 2;
  const bgAlpha = Math.max(0, Math.min(1, bgStripOpacity));
  const R = Math.max(0, Math.min(borderRadius, Math.floor(stripHeight / 2)));

  // Write filter_complex to a temp file to avoid shell escaping issues
  const filterFile = path.join(tempDir, "filter_" + Math.random().toString(36).substring(2, 9) + ".txt");

  let filterComplex: string;

  if (R > 0) {
    const bgHex = bgStripColor.startsWith("#") ? bgStripColor.slice(1) : bgStripColor;
    const cR = parseInt(bgHex.substring(0, 2), 16) || 0;
    const cG = parseInt(bgHex.substring(2, 4), 16) || 0;
    const cB = parseInt(bgHex.substring(4, 6), 16) || 0;
    const alphaVal = Math.round(255 * bgAlpha);

    filterComplex = [
      `[0:v]scale='if(gte(iw/ih,${OUTPUT_W}/${OUTPUT_H}),-1,${OUTPUT_W})':'if(gte(iw/ih,${OUTPUT_W}/${OUTPUT_H}),${OUTPUT_H},-1)',crop=${OUTPUT_W}:${OUTPUT_H}[scaled]`,
      `color=c=0x${bgHex.padEnd(6, "0")}:s=${stripW}x${stripHeight},format=yuva420p,geq=r='${cR}':g='${cG}':b='${cB}':a='if(gt(hypot(max(0,${R}-min(X,W-1-X)),max(0,${R}-min(Y,H-1-Y))),${R}),0,${alphaVal})'[rrect]`,
      `[scaled][rrect]overlay=x=${stripX}:y=${stripY}:shortest=1[bg]`,
      `[bg]drawtext=fontfile='${escapedFontPath}':textfile='${escapedTextFilePath}':fontcolor=${drawFontColor}:fontsize=${fontSize}:x='max(${stripX + paddingX},${stripX}+(${stripW}-text_w)/2)':y=${textY}:line_spacing=6[v]`,
    ].join(";\n");
  } else {
    const bgColorFfmpeg = bgStripColor.startsWith("#") ? "0x" + bgStripColor.slice(1) : bgStripColor;
    filterComplex = [
      `[0:v]scale='if(gte(iw/ih,${OUTPUT_W}/${OUTPUT_H}),-1,${OUTPUT_W})':'if(gte(iw/ih,${OUTPUT_W}/${OUTPUT_H}),${OUTPUT_H},-1)',crop=${OUTPUT_W}:${OUTPUT_H},drawbox=x=${stripX}:y=${stripY}:w=${stripW}:h=${stripHeight}:color=${bgColorFfmpeg}@${bgAlpha}:t=fill,drawtext=fontfile='${escapedFontPath}':textfile='${escapedTextFilePath}':fontcolor=${drawFontColor}:fontsize=${fontSize}:x='max(${stripX + paddingX},${stripX}+(${stripW}-text_w)/2)':y=${textY}:line_spacing=6[v]`,
    ].join("");
  }

  fs.writeFileSync(filterFile, filterComplex);

  const cmd = [
    "ffmpeg -y",
    `-i "${inputVideoPath}"`,
    `-filter_complex_script "${filterFile}"`,
    '-map "[v]" -map 0:a?',
    "-c:v libx264 -preset fast -crf 23",
    "-c:a aac -b:a 128k",
    "-shortest",
    "-movflags +faststart",
    `"${outputPath}"`,
  ].join(" ");

  console.log("[Multiplier Composer] Running:", cmd.substring(0, 400) + "...");

  return new Promise<string>((resolve, reject) => {
    exec(cmd, { maxBuffer: 50 * 1024 * 1024 }, (error, _stdout, stderr) => {
      try { if (fs.existsSync(textFilePath)) fs.unlinkSync(textFilePath); } catch {}
      try { if (fs.existsSync(filterFile)) fs.unlinkSync(filterFile); } catch {}

      if (error) {
        console.error("[Multiplier Composer] FFmpeg failed:", stderr?.substring(0, 500));
        reject(new Error("FFmpeg composition failed: " + error.message));
        return;
      }
      if (!fs.existsSync(outputPath)) {
        reject(new Error("FFmpeg did not produce output file"));
        return;
      }
      console.log("[Multiplier Composer] Successfully rendered:", outputPath);
      resolve(outputPath);
    });
  });
}

