import { exec, execSync, spawn } from "child_process";
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
 * Extra-aggressive sanitizer for Multiplier hook text.
 * Strips ALL quotes, special chars, and FFmpeg-breaking characters.
 * Hook text is display-only — it never needs special characters.
 */
function sanitizeMultiplierHookText(text: string): string {
  let cleaned = sanitizeQuoteText(text)
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Strip ALL quotes (double + single) — common CSV artifacts, never wanted in video overlays
  cleaned = cleaned.replace(/["']/g, "");
  // Strip FFmpeg-breaking characters: colons, semicolons, brackets, braces, backslashes, percent
  cleaned = cleaned.replace(/[:\\;[\]{}%\\]/g, "");
  // Collapse any resulting double-spaces
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned;
}

/**
 * Escapes text for FFmpeg's drawtext filter in a filter_complex_script file.
 * Since sanitizeMultiplierHookText already strips all dangerous characters,
 * this only needs minimal escaping for the text='...' parameter context.
 */
function escapeMultiplierDrawtext(text: string): string {
  // In filter_complex_script with text='...', single quotes inside the text
  // would break parsing. We already stripped them in the sanitizer.
  // Just escape any remaining backslashes.
  return text.replace(/\\/g, "\\\\");
}

/**
 * Escapes text for FFmpeg's drawtext filter (used by the genre composer).
 * Handles FFmpeg filter-syntax reserved characters for filter_complex_script text="..." params.
 */
function escapeFfmpegDrawtext(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/%/g, "%%")
    .replace(/;/g, "\\;")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}");
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
      // If the word itself is longer than maxCharsPerLine, force-break it
      if (word.length > maxCharsPerLine) {
        if (currentLine) {
          finalLines.push(currentLine);
          currentLine = "";
        }
        // Break the long word into chunks
        for (let i = 0; i < word.length; i += maxCharsPerLine) {
          const chunk = word.substring(i, i + maxCharsPerLine);
          finalLines.push(chunk);
        }
        continue;
      }

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
  const lineTextFiles: string[] = [];

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

    // Convert SVG to PNG using rsvg-convert because FFmpeg's standard Alpine build lacks native SVG decoding support
    const pngFilePath = svgFilePath.replace(/\.svg$/, ".png");
    try {
      execSync(`rsvg-convert -w 720 -h 1280 -o "${pngFilePath}" "${svgFilePath}"`);
      svgFilePath = pngFilePath;
      console.log(`[Composer] Curved SVG successfully rasterized to transparent PNG at: ${svgFilePath}`);
    } catch (err) {
      console.error("[Composer] Failed to convert curved SVG to PNG. Falling back to SVG.", err);
    }

    // Build the filter complex overlaying the rasterized image onto scaled/cropped background
    filterComplex = [
      `[0:v]scale='if(gte(iw/ih,720/1280),-1,720)':'if(gte(iw/ih,720/1280),1280,-1)',crop=720:1280[bg]`,
      `[2:v]format=yuva420p,fade=in:st=0:d=0.5:alpha=1,fade=out:st=${fadeStart}:d=0.5:alpha=1[v_overlay]`,
      `[bg][v_overlay]overlay=x=0:y=0[v]`,
      `[1:a]afade=t=out:st=${fadeStart}:d=1[a]`
    ].join(";");

  } else {
    // Advanced chained drawtext rendering with full background strip, margins, padding, and rounded corners visual parity with Multiplier
    const OUTPUT_W = 720;
    const OUTPUT_H = 1280;

    const marginX = 40;
    const stripPaddingY = 20;
    const paddingX = 20;
    const borderRadius = 12;

    const effectiveTextWidth = OUTPUT_W - marginX * 2 - paddingX * 2;
    const charsPerLine = Math.max(10, Math.floor(effectiveTextWidth / (fontSize * 0.62)));

    const cleanQuote = sanitizeQuoteText(quoteText);
    const casedText = applyCasing(cleanQuote, textCase);
    const wrappedText = wrapText(casedText, charsPerLine);

    let fullText = wrappedText;
    if (quoteAuthor && quoteAuthor.trim()) {
      fullText += `\n\n— ${quoteAuthor.trim()}`;
    }
    const lines = fullText.split("\n").map((line) => line.trim().replace(/\r/g, ""));

    const drawFontColor = formatFfmpegColor(fontColor);
    const lineCount = lines.length;
    const lineHeight = fontSize * 1.4;
    const stripHeight = Math.round(lineCount * lineHeight + stripPaddingY * 2 + 10);
    const yPercent = Math.max(0, Math.min(100, positionY));
    const maxY = OUTPUT_H - stripHeight;
    const stripY = Math.round((maxY * yPercent) / 100);
    const textY = stripY + stripPaddingY;
    const stripX = marginX;
    const stripW = OUTPUT_W - marginX * 2;

    let bgStripColor = "#000000";
    let bgStripOpacity = 0.0;
    const isTransparent = !boxColor || boxColor.toLowerCase() === "none";
    if (!isTransparent) {
      const parts = boxColor.split("@");
      if (parts.length === 2) {
        bgStripColor = parts[0];
        bgStripOpacity = parseFloat(parts[1]) ?? 0.4;
      } else {
        bgStripColor = boxColor;
        bgStripOpacity = 1.0;
      }
    }
    const bgAlpha = Math.max(0, Math.min(1, bgStripOpacity));
    const R = isTransparent ? 0 : Math.max(0, Math.min(borderRadius, Math.floor(stripHeight / 2)));

    const escapedFontPath = resolvedFont.replace(/\\/g, "/").replace(/:/g, "\\:");
    textFilePath = path.join(tempDir, `filter_genre_${Math.random().toString(36).substring(2, 9)}.txt`);

    let lastLabel = "[bg]";
    const drawtextFilters: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineY = Math.round(textY + i * lineHeight);
      const nextLabel = i === lines.length - 1 ? "[v]" : `[t${i}]`;

      // Write each line literally to a temporary file to bypass all FFmpeg escaping limitations
      const lineFile = path.join(tempDir, `line_${i}_${Math.random().toString(36).substring(2, 9)}.txt`);
      fs.writeFileSync(lineFile, line, "utf8");
      lineTextFiles.push(lineFile);

      const escapedLineFilePath = lineFile.replace(/\\/g, "/").replace(/'/g, "'\\''");

      let drawShadowStr = "";
      if (shadowColor && shadowColor.toLowerCase() !== "none") {
        const drawShadowColor = formatFfmpegColor(shadowColor);
        drawShadowStr = `:shadowcolor=${drawShadowColor}:shadowx=2:shadowy=2`;
      }

      const alphaStr = `:alpha='if(lt(t\\,0.5)\\,t/0.5\\,if(gt(t\\,${videoLength}-0.5)\\,(${videoLength}-t)/0.5\\,1))'`;

      drawtextFilters.push(
        `${lastLabel}drawtext=fontfile='${escapedFontPath}':textfile='${escapedLineFilePath}':fontcolor=${drawFontColor}:fontsize=${fontSize}:x='max(${stripX + paddingX}\\,${stripX}+(${stripW}-text_w)/2)':y=${lineY}${drawShadowStr}${alphaStr}:expansion=none${nextLabel}`
      );
      lastLabel = nextLabel;
    }

    if (R > 0) {
      const bgHex = bgStripColor.startsWith("#") ? bgStripColor.slice(1) : bgStripColor;
      const cR = parseInt(bgHex.substring(0, 2), 16) || 0;
      const cG = parseInt(bgHex.substring(2, 4), 16) || 0;
      const cB = parseInt(bgHex.substring(4, 6), 16) || 0;
      const alphaVal = Math.round(255 * bgAlpha);

      filterComplex = [
        `[0:v]scale='if(gte(iw/ih,${OUTPUT_W}/${OUTPUT_H}),-1,${OUTPUT_W})':'if(gte(iw/ih,${OUTPUT_W}/${OUTPUT_H}),${OUTPUT_H},-1)',crop=${OUTPUT_W}:${OUTPUT_H}[scaled]`,
        // Set duration to 1s (:d=1) so geq math evaluates ONLY once for a static frame instead of every single frame (300x speedup!)
        `color=c=0x${bgHex.padEnd(6, "0")}:s=${stripW}x${stripHeight}:d=1:r=1,format=yuva420p,geq=r='${cR}':g='${cG}':b='${cB}':a='if(gt(hypot(max(0,${R}-min(X,W-1-X)),max(0,${R}-min(Y,H-1-Y))),${R}),0,${alphaVal})'[rrect]`,
        // overlay repeats last frame indefinitely (eof_action=repeat) which is extremely cheap and fast
        `[scaled][rrect]overlay=x=${stripX}:y=${stripY}:eof_action=repeat[bg]`,
        ...drawtextFilters,
        `[1:a]afade=t=out:st=${fadeStart}:d=1[a]`
      ].join(";\n");
    } else {
      const bgColorFfmpeg = bgStripColor.startsWith("#") ? "0x" + bgStripColor.slice(1) : bgStripColor;
      const drawBoxOverlay = isTransparent
        ? `[0:v]scale='if(gte(iw/ih,${OUTPUT_W}/${OUTPUT_H}),-1,${OUTPUT_W})':'if(gte(iw/ih,${OUTPUT_W}/${OUTPUT_H}),${OUTPUT_H},-1)',crop=${OUTPUT_W}:${OUTPUT_H}[bg]`
        : `[0:v]scale='if(gte(iw/ih,${OUTPUT_W}/${OUTPUT_H}),-1,${OUTPUT_W})':'if(gte(iw/ih,${OUTPUT_W}/${OUTPUT_H}),${OUTPUT_H},-1)',crop=${OUTPUT_W}:${OUTPUT_H},drawbox=x=${stripX}:y=${stripY}:w=${stripW}:h=${stripHeight}:color=${bgColorFfmpeg}@${bgAlpha}:t=fill[bg]`;

      filterComplex = [
        drawBoxOverlay,
        ...drawtextFilters,
        `[1:a]afade=t=out:st=${fadeStart}:d=1[a]`
      ].join(";\n");
    }

    fs.writeFileSync(textFilePath, filterComplex);
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
      ...(curveText ? [`-i "${svgFilePath}"`, "-filter_complex", `"${filterComplex}"`] : ["-filter_complex_script", `"${textFilePath}"`]),
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

    exec(cmd, { maxBuffer: 1024 * 1024 * 50, timeout: 300000, killSignal: "SIGKILL" }, (error, stdout, stderr) => {
      // Always cleanup temporary files
      try {
        if (!curveText && textFilePath && fs.existsSync(textFilePath)) {
          fs.unlinkSync(textFilePath);
        }
        for (const lineFile of lineTextFiles) {
          if (fs.existsSync(lineFile)) {
            fs.unlinkSync(lineFile);
          }
        }
      } catch (err) {
        console.error("[Composer] Failed to cleanup temp text file", err);
      }

      try {
        if (curveText && svgFilePath) {
          if (fs.existsSync(svgFilePath)) {
            fs.unlinkSync(svgFilePath);
          }
          const originalSvg = svgFilePath.replace(/\.png$/, ".svg");
          if (fs.existsSync(originalSvg)) {
            fs.unlinkSync(originalSvg);
          }
        }
      } catch (err) {
        console.error("[Composer] Failed to cleanup temp SVG/PNG files", err);
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

  const effectiveMaxReuse = maxReuse <= 0 ? 999999 : maxReuse;
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
      if (trackUsage[track.id] < effectiveMaxReuse) {
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

// Multiplier Compose Options
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

  // Design template fields
  paddingX?: number;
  textAlign?: "LEFT" | "CENTER" | "RIGHT";
  lineHeight?: number;
  letterSpacing?: number;
  stripWidthMode?: "FULL" | "FIT";
  stripWidthPercent?: number;

  // Text effects
  strokeEnabled?: boolean;
  strokeColor?: string;
  strokeWidth?: number;
  shadowEnabled?: boolean;
  shadowColor?: string;
  shadowX?: number;
  shadowY?: number;
  glowEnabled?: boolean;
  glowColor?: string;
  glowIntensity?: number;

  // Strip effects
  stripBorderEnabled?: boolean;
  stripBorderColor?: string;
  stripBorderWidth?: number;
  stripShadowEnabled?: boolean;
  stripShadowColor?: string;
  stripShadowOffset?: number;

  // ── Advanced: Gradient Strip ──
  stripGradientEnabled?: boolean;
  stripGradientColor2?: string;
  stripGradientAngle?: number;

  // ── Advanced: Strip Shape ──
  stripShape?: string; // FULL | PILL | NONE

  // ── Advanced: Entrance Animation ──
  animationType?: string; // NONE | FADE_IN | SLIDE_UP | SCALE_IN
  animationDuration?: number;

  // ── Advanced: Backdrop Blur ──
  backdropBlurEnabled?: boolean;
  backdropBlurRadius?: number;

  // ── Advanced: Text Gradient ──
  textGradientEnabled?: boolean;
  textGradientColor1?: string;
  textGradientColor2?: string;
  textGradientAngle?: number;

  // ── Advanced: Double Text (outline + fill) ──
  doubleTextEnabled?: boolean;
  doubleTextOutlineColor?: string;
  doubleTextOutlineWidth?: number;
}

export async function composeMultiplierVideo(options: MultiplierComposeOptions): Promise<string> {
  const {
    inputVideoPath, hookText, fontFamily, fontSize, fontColor, textCase,
    bgStripColor, bgStripOpacity, stripPaddingY, positionYPercent,
    marginX, borderRadius, outputPath,
    paddingX: rawPaddingX, textAlign = "CENTER", lineHeight: rawLineHeight,
    strokeEnabled = false, strokeColor = "#000000", strokeWidth = 2,
    shadowEnabled = false, shadowColor = "#000000", shadowX = 2, shadowY = 2,
    glowEnabled = false, glowColor = "#FF00FF", glowIntensity = 2,
    stripBorderEnabled = false, stripBorderColor = "#FFFFFF", stripBorderWidth = 1,
    stripShadowEnabled = false, stripShadowColor = "#000000", stripShadowOffset = 4,
    // Advanced
    stripGradientEnabled = false, stripGradientColor2 = "#333333", stripGradientAngle = 90,
    stripShape = "FULL",
    animationType = "NONE", animationDuration = 0.5,
    backdropBlurEnabled = false, backdropBlurRadius = 10,
    doubleTextEnabled = false, doubleTextOutlineColor = "#000000", doubleTextOutlineWidth = 4,
  } = options;

  const OUTPUT_W = 720;
  const OUTPUT_H = 1280;

  const resolvedFont = await resolveFontPath(fontFamily);
  const escapedFontPath = resolvedFont.replace(/\\/g, "/").replace(/:/g, "\\:");

  const cleanText = sanitizeMultiplierHookText(hookText);
  const casedText = applyCasing(cleanText, textCase);

  const tempDir = path.join(os.tmpdir(), "temp_multiplier");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const padX = rawPaddingX ?? Math.max(stripPaddingY, 16);
  const padY = stripPaddingY;
  const effectiveTextWidth = OUTPUT_W - marginX * 2 - padX * 2;
  // Adaptive char width: uppercase bold fonts are MUCH wider than mixed-case.
  // Use worst-case estimates to guarantee text never overflows the strip.
  const isUppercase = textCase.trim().toLowerCase() === "uppercase";
  const charWidthMultiplier = isUppercase ? 0.65 : 0.55;
  const charsPerLine = Math.max(8, Math.floor(effectiveTextWidth / (fontSize * charWidthMultiplier)));
  const wrappedText = wrapText(casedText, charsPerLine);
  const lines = wrappedText.split("\n").map((line) => line.trim().replace(/\r/g, ""));

  const drawFontColor = formatFfmpegColor(fontColor);
  const lh = rawLineHeight ?? 1.4;
  const lineHeightPx = fontSize * lh;
  const lineCount = lines.length;
  const stripHeight = Math.round(lineCount * lineHeightPx + padY * 2 + 10);
  const yPercent = Math.max(0, Math.min(100, positionYPercent));
  const maxY = OUTPUT_H - stripHeight;
  const stripY = Math.round((maxY * yPercent) / 100);
  const textYBase = stripY + padY;
  const stripX = marginX;
  const stripW = OUTPUT_W - marginX * 2;
  const bgAlpha = Math.max(0, Math.min(1, bgStripOpacity));
  const R = Math.max(0, Math.min(borderRadius, Math.floor(stripHeight / 2)));

  // Build alignment X expression — clamped to strip bounds
  function buildAlignX(): string {
    const leftX = stripX + padX;
    const rightBound = stripX + stripW - padX;
    // Center: clamp between leftX and rightBound-text_w to guarantee text stays inside strip
    const centerExpr = `min(${rightBound}-text_w\\,max(${leftX}\\,${stripX}+(${stripW}-text_w)/2))`;
    const rightExpr = `min(${rightBound}-text_w\\,${stripX + stripW - padX}-text_w)`;
    if (textAlign === "LEFT") return String(leftX);
    if (textAlign === "RIGHT") return `'${rightExpr}'`;
    return `'${centerExpr}'`;
  }

  const alignX = buildAlignX();

  // Build drawtext params for a single line
  function buildDrawtextParams(escapedText: string, lineY: number): string {
    let params = `fontfile='${escapedFontPath}':text='${escapedText}':fontcolor=${drawFontColor}:fontsize=${fontSize}:x=${alignX}:y=${lineY}:expansion=none`;

    if (strokeEnabled && strokeWidth > 0) {
      const strokeCol = formatFfmpegColor(strokeColor);
      params += `:borderw=${strokeWidth}:bordercolor=${strokeCol}`;
    }

    if (shadowEnabled) {
      const shadowCol = formatFfmpegColor(shadowColor);
      params += `:shadowx=${shadowX}:shadowy=${shadowY}:shadowcolor=${shadowCol}`;
    }

    return params;
  }

  // Write filter_complex to a temp file
  const filterFile = path.join(tempDir, "filter_" + Math.random().toString(36).substring(2, 9) + ".txt");

  const bgHex = bgStripColor.startsWith("#") ? bgStripColor.slice(1) : bgStripColor;
  const cR = parseInt(bgHex.substring(0, 2), 16) || 0;
  const cG = parseInt(bgHex.substring(2, 4), 16) || 0;
  const cB = parseInt(bgHex.substring(4, 6), 16) || 0;
  const alphaVal = Math.round(255 * bgAlpha);

  // Scale + crop input
  const scaleFilter = `[0:v]scale='if(gte(iw/ih,${OUTPUT_W}/${OUTPUT_H}),-1,${OUTPUT_W})':'if(gte(iw/ih,${OUTPUT_W}/${OUTPUT_H}),${OUTPUT_H},-1)',crop=${OUTPUT_W}:${OUTPUT_H}[scaled]`;

  const filterParts: string[] = [scaleFilter];
  let currentLabel = "[scaled]";
  let nextLabelIdx = 0;
  const getNextLabel = (isFinal: boolean) => isFinal ? "[v]" : `[s${nextLabelIdx++}]`;

  // Determine if strip should be drawn at all
  const drawStrip = stripShape !== "NONE";
  const drawStripBg = drawStrip && bgAlpha > 0;

  // For PILL shape, shrink strip width to fit text content + padding
  let effectiveStripW = stripW;
  let effectiveStripX = stripX;
  if (stripShape === "PILL") {
    // Estimate text width from longest line
    const longestLine = lines.reduce((a, b) => a.length > b.length ? a : b, "");
    const estTextW = Math.round(longestLine.length * fontSize * 0.62);
    effectiveStripW = Math.min(stripW, estTextW + padX * 2 + 16);
    effectiveStripX = Math.round((OUTPUT_W - effectiveStripW) / 2);
  }

  // Compute effective corner radius
  const effectiveR = drawStrip
    ? (stripShape === "PILL" ? Math.max(R, Math.floor(stripHeight / 2)) : R)
    : 0;

  // ── Backdrop Blur (blurred region behind strip) ───────────────────────
  if (backdropBlurEnabled && backdropBlurRadius > 0 && drawStrip) {
    const blurR = Math.min(backdropBlurRadius, 10); // capped at 10 for performance
    const outLabel = getNextLabel(false);
    // Crop the strip region, blur it, and overlay it back at the same position
    filterParts.push(
      `${currentLabel}split[blur_base][blur_src]`
    );
    const blurLabel = getNextLabel(false);
    filterParts.push(
      `[blur_src]crop=${effectiveStripW}:${stripHeight}:${effectiveStripX}:${stripY},boxblur=${blurR}:${blurR}${blurLabel}`
    );
    filterParts.push(
      `[blur_base]${blurLabel}overlay=x=${effectiveStripX}:y=${stripY}${outLabel}`
    );
    currentLabel = outLabel;
  }

  // ── Strip Shadow (geq rounded rect, semi-transparent) ─────────────────
  if (drawStrip && stripShadowEnabled && stripShadowOffset > 0) {
    const shHex = (stripShadowColor || "#000000").startsWith("#") ? (stripShadowColor || "#000000").slice(1) : (stripShadowColor || "#000000");
    const shR = parseInt(shHex.substring(0, 2), 16) || 0;
    const shG = parseInt(shHex.substring(2, 4), 16) || 0;
    const shB = parseInt(shHex.substring(4, 6), 16) || 0;
    const shAlpha = Math.round(255 * 0.4); // 40% opacity for shadow
    const shX = effectiveStripX + stripShadowOffset;
    const shY = stripY + stripShadowOffset;

    if (effectiveR > 0) {
      const shLabel = getNextLabel(false);
      filterParts.push(
        `color=c=0x${shHex.padEnd(6, "0")}:s=${effectiveStripW}x${stripHeight}:d=1:r=1,format=yuva420p,geq=r='${shR}':g='${shG}':b='${shB}':a='if(gt(hypot(max(0,${effectiveR}-min(X,W-1-X)),max(0,${effectiveR}-min(Y,H-1-Y))),${effectiveR}),0,${shAlpha})'${shLabel}`
      );
      const shOverLabel = getNextLabel(false);
      filterParts.push(
        `${currentLabel}${shLabel}overlay=x=${shX}:y=${shY}:eof_action=repeat${shOverLabel}`
      );
      currentLabel = shOverLabel;
    } else {
      const outLabel = getNextLabel(false);
      filterParts.push(
        `${currentLabel}drawbox=x=${shX}:y=${shY}:w=${effectiveStripW}:h=${stripHeight}:color=0x${shHex.padEnd(6, "0")}@0.4:t=fill${outLabel}`
      );
      currentLabel = outLabel;
    }
  }

  // ── Strip Border (geq rounded ring overlay) ───────────────────────────
  if (drawStrip && stripBorderEnabled && stripBorderWidth > 0) {
    const brdHex = (stripBorderColor || "#FFFFFF").startsWith("#") ? (stripBorderColor || "#FFFFFF").slice(1) : (stripBorderColor || "#FFFFFF");
    const brdR = parseInt(brdHex.substring(0, 2), 16) || 255;
    const brdG = parseInt(brdHex.substring(2, 4), 16) || 255;
    const brdB = parseInt(brdHex.substring(4, 6), 16) || 255;
    const bw = Math.max(1, stripBorderWidth);
    const brdTotalW = effectiveStripW + bw * 2;
    const brdTotalH = stripHeight + bw * 2;
    const outerR = effectiveR + bw;
    const innerR = effectiveR;

    // Draw a ring: opaque where inside outer rounded rect AND outside inner rounded rect
    const brdLabel = getNextLabel(false);
    // Outer distance from corner: pixels outside outer rounded rect → transparent
    // Inner distance from corner: pixels inside inner rounded rect → transparent (the "hole")
    // The border ring: between outer and inner → opaque
    const outerDist = `hypot(max(0,${outerR}-min(X,W-1-X)),max(0,${outerR}-min(Y,H-1-Y)))`;
    const innerDist = `hypot(max(0,${innerR}-min(X-${bw},W-1-X-${bw})),max(0,${innerR}-min(Y-${bw},H-1-Y-${bw})))`;
    filterParts.push(
      `color=c=0x${brdHex.padEnd(6, "0")}:s=${brdTotalW}x${brdTotalH}:d=1:r=1,format=yuva420p,geq=r='${brdR}':g='${brdG}':b='${brdB}':a='if(gt(${outerDist},${outerR}),0,if(lt(${innerDist},${innerR}),0,255))'${brdLabel}`
    );
    const brdOverLabel = getNextLabel(false);
    filterParts.push(
      `${currentLabel}${brdLabel}overlay=x=${effectiveStripX - bw}:y=${stripY - bw}:eof_action=repeat${brdOverLabel}`
    );
    currentLabel = brdOverLabel;
  }

  // ── Background Strip ──────────────────────────────────────────────────
  if (drawStripBg) {
    if (stripGradientEnabled) {
      // Gradient strip: interpolate between two colors using geq
      const hex2 = (stripGradientColor2 || "#333333").startsWith("#") ? (stripGradientColor2 || "#333333").slice(1) : (stripGradientColor2 || "#333333");
      const c2R = parseInt(hex2.substring(0, 2), 16) || 0;
      const c2G = parseInt(hex2.substring(2, 4), 16) || 0;
      const c2B = parseInt(hex2.substring(4, 6), 16) || 0;

      // Horizontal gradient (angle=90 default): interpolate using X/W
      // Vertical gradient (angle=0/180): interpolate using Y/H
      const isVertical = stripGradientAngle === 0 || stripGradientAngle === 180;
      const gradAxis = isVertical ? "Y" : "X";
      const gradSize = isVertical ? "H" : "W";
      const gradR = `'${cR}+(${c2R}-${cR})*${gradAxis}/${gradSize}'`;
      const gradG = `'${cG}+(${c2G}-${cG})*${gradAxis}/${gradSize}'`;
      const gradB = `'${cB}+(${c2B}-${cB})*${gradAxis}/${gradSize}'`;

      if (effectiveR > 0) {
        const rrectLabel = getNextLabel(false);
        filterParts.push(
          `color=c=0x${bgHex.padEnd(6, "0")}:s=${effectiveStripW}x${stripHeight}:d=1:r=1,format=yuva420p,geq=r=${gradR}:g=${gradG}:b=${gradB}:a='if(gt(hypot(max(0,${effectiveR}-min(X,W-1-X)),max(0,${effectiveR}-min(Y,H-1-Y))),${effectiveR}),0,${alphaVal})'[rrect]`
        );
        const bgLabel = getNextLabel(false);
        filterParts.push(
          `${currentLabel}[rrect]overlay=x=${effectiveStripX}:y=${stripY}:eof_action=repeat${bgLabel}`
        );
        currentLabel = bgLabel;
      } else {
        const rrectLabel = getNextLabel(false);
        filterParts.push(
          `color=c=0x${bgHex.padEnd(6, "0")}:s=${effectiveStripW}x${stripHeight}:d=1:r=1,format=yuva420p,geq=r=${gradR}:g=${gradG}:b=${gradB}:a='${alphaVal}'[rrect]`
        );
        const bgLabel = getNextLabel(false);
        filterParts.push(
          `${currentLabel}[rrect]overlay=x=${effectiveStripX}:y=${stripY}:eof_action=repeat${bgLabel}`
        );
        currentLabel = bgLabel;
      }
    } else if (effectiveR > 0) {
      // Rounded rect via geq overlay (existing)
      const rrectLabel = getNextLabel(false);
      filterParts.push(
        `color=c=0x${bgHex.padEnd(6, "0")}:s=${effectiveStripW}x${stripHeight}:d=1:r=1,format=yuva420p,geq=r='${cR}':g='${cG}':b='${cB}':a='if(gt(hypot(max(0,${effectiveR}-min(X,W-1-X)),max(0,${effectiveR}-min(Y,H-1-Y))),${effectiveR}),0,${alphaVal})'[rrect]`
      );
      const bgLabel = getNextLabel(false);
      filterParts.push(
        `${currentLabel}[rrect]overlay=x=${effectiveStripX}:y=${stripY}:eof_action=repeat${bgLabel}`
      );
      currentLabel = bgLabel;
    } else {
      // Simple drawbox
      const bgColorFfmpeg = bgStripColor.startsWith("#") ? "0x" + bgStripColor.slice(1) : bgStripColor;
      const bgLabel = getNextLabel(false);
      filterParts.push(
        `${currentLabel}drawbox=x=${effectiveStripX}:y=${stripY}:w=${effectiveStripW}:h=${stripHeight}:color=${bgColorFfmpeg}@${bgAlpha}:t=fill${bgLabel}`
      );
      currentLabel = bgLabel;
    }
  }

  // ── Build entrance animation alpha expression ─────────────────────────
  let alphaExpr = "";
  if (animationType === "FADE_IN" && animationDuration > 0) {
    // Fade alpha from 0 to 1 over animationDuration seconds
    const dur = Math.max(0.1, animationDuration);
    alphaExpr = `:alpha='if(lt(t\\,${dur})\\,t/${dur}\\,1)'`;
  }

  // For SLIDE_UP, we offset Y based on time (slide from below into position)
  function getAnimatedY(staticY: number): string {
    if (animationType === "SLIDE_UP" && animationDuration > 0) {
      const dur = Math.max(0.1, animationDuration);
      const slideOffset = 60; // pixels to slide from
      return `'${staticY}+if(lt(t\\,${dur})\\,${slideOffset}*(1-t/${dur})\\,0)'`;
    }
    return String(staticY);
  }

  // ── Neon Glow (shadow-only passes underneath main text) ────────────────
  // Match CSS text-shadow behavior: only the SHADOW carries the glow color.
  // The text body itself is transparent so it doesn't tint the main text.
  if (glowEnabled && glowIntensity > 0) {
    const glowCol = formatFfmpegColor(glowColor);
    const passes = Math.min(glowIntensity, 3);
    for (let pass = passes; pass >= 1; pass--) {
      const offset = pass * 2;
      for (let i = 0; i < lines.length; i++) {
        const lineY = Math.round(textYBase + i * lineHeightPx);
        const yExpr = getAnimatedY(lineY);
        const escapedLineText = escapeMultiplierDrawtext(lines[i]);
        const outLabel = getNextLabel(false);
        // Use the main text color at 0% opacity for the text body so only
        // the shadow (glow) is visible — prevents glow color tinting the text
        filterParts.push(
          `${currentLabel}drawtext=fontfile='${escapedFontPath}':text='${escapedLineText}':fontcolor=${drawFontColor}@0.0:fontsize=${fontSize}:x=${alignX}:y=${yExpr}:shadowx=${offset}:shadowy=${offset}:shadowcolor=${glowCol}@0.6:expansion=none${alphaExpr}${outLabel}`
        );
        currentLabel = outLabel;
      }
    }
  }

  // ── Double Text: Outline Pass (thick borderw underneath main text) ─────
  if (doubleTextEnabled && doubleTextOutlineWidth > 0) {
    const outlineCol = formatFfmpegColor(doubleTextOutlineColor);
    for (let i = 0; i < lines.length; i++) {
      const lineY = Math.round(textYBase + i * lineHeightPx);
      const yExpr = getAnimatedY(lineY);
      const escapedLineText = escapeMultiplierDrawtext(lines[i]);
      const outLabel = getNextLabel(false);
      filterParts.push(
        `${currentLabel}drawtext=fontfile='${escapedFontPath}':text='${escapedLineText}':fontcolor=${outlineCol}:fontsize=${fontSize}:x=${alignX}:y=${yExpr}:borderw=${doubleTextOutlineWidth}:bordercolor=${outlineCol}:expansion=none${alphaExpr}${outLabel}`
      );
      currentLabel = outLabel;
    }
  }

  // ── Main Text Drawtext Chain ──────────────────────────────────────────
  for (let i = 0; i < lines.length; i++) {
    const lineY = Math.round(textYBase + i * lineHeightPx);
    const yExpr = getAnimatedY(lineY);
    const escapedLineText = escapeMultiplierDrawtext(lines[i]);
    const isFinal = i === lines.length - 1;
    const outLabel = getNextLabel(isFinal);

    // Build params with animated Y
    let params = `fontfile='${escapedFontPath}':text='${escapedLineText}':fontcolor=${drawFontColor}:fontsize=${fontSize}:x=${alignX}:y=${yExpr}:expansion=none`;
    if (strokeEnabled && strokeWidth > 0) {
      const strokeCol = formatFfmpegColor(strokeColor);
      params += `:borderw=${strokeWidth}:bordercolor=${strokeCol}`;
    }
    if (shadowEnabled) {
      const shadowCol = formatFfmpegColor(shadowColor);
      params += `:shadowx=${shadowX}:shadowy=${shadowY}:shadowcolor=${shadowCol}`;
    }
    params += alphaExpr;

    filterParts.push(
      `${currentLabel}drawtext=${params}${outLabel}`
    );
    currentLabel = outLabel;
  }

  const filterComplex = filterParts.join(";\n");
  fs.writeFileSync(filterFile, filterComplex);

  const ffmpegArgs = [
    "-y",
    "-i", inputVideoPath,
    "-filter_complex_script", filterFile,
    "-map", "[v]", "-map", "0:a?",
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
    "-threads", "2",
    "-c:a", "aac", "-b:a", "128k",
    "-shortest",
    "-movflags", "+faststart",
    outputPath,
  ];

  console.log("[Multiplier Composer] fontColor:", fontColor, "→ drawFontColor:", drawFontColor);
  console.log("[Multiplier Composer] charsPerLine:", charsPerLine, "fontSize:", fontSize, "effectiveTextWidth:", effectiveTextWidth);
  console.log("[Multiplier Composer] lines:", lines);
  console.log("[Multiplier Composer] Filter script:\n", filterComplex.substring(0, 2000));
  console.log("[Multiplier Composer] Running ffmpeg with", ffmpegArgs.length, "args");

  const TIMEOUT_MS = 120_000; // 2 minutes per video

  return new Promise<string>((resolve, reject) => {
    const proc = spawn("ffmpeg", ffmpegArgs, { stdio: ["pipe", "pipe", "pipe"] });
    let stderrChunks: string[] = [];
    let killed = false;
    let finished = false;

    // Timeout: force-kill if FFmpeg hangs
    const timer = setTimeout(() => {
      if (!finished) {
        killed = true;
        console.error(`[Multiplier Composer] TIMEOUT after ${TIMEOUT_MS / 1000}s — killing FFmpeg`);
        proc.kill("SIGKILL");
      }
    }, TIMEOUT_MS);

    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      // Keep last 20 chunks for diagnostics (prevent memory bloat)
      stderrChunks.push(text);
      if (stderrChunks.length > 20) stderrChunks.shift();
    });

    proc.on("error", (err) => {
      finished = true;
      clearTimeout(timer);
      try { if (fs.existsSync(filterFile)) fs.unlinkSync(filterFile); } catch {}
      reject(new Error("FFmpeg spawn error: " + err.message));
    });

    proc.on("close", (code) => {
      finished = true;
      clearTimeout(timer);
      try { if (fs.existsSync(filterFile)) fs.unlinkSync(filterFile); } catch {}

      const stderrText = stderrChunks.join("");

      if (killed) {
        reject(new Error(`FFmpeg timed out after ${TIMEOUT_MS / 1000}s. The video may be too long or the template too complex.`));
        return;
      }

      if (code !== 0) {
        console.error("[Multiplier Composer] FFmpeg failed (code", code, "):", stderrText.substring(stderrText.length - 1000));
        reject(new Error("FFmpeg composition failed (exit code " + code + "): " + stderrText.substring(stderrText.length - 500)));
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
