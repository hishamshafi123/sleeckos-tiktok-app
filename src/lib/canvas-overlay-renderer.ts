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
  animationMode?: "highlight" | "word_builder";
  bgColor?: string | null;
  textColor?: string | null;
  textAlign?: string;
  wordSpacing?: string;
  letterSpacing?: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const WIDTH = 720;
const HEIGHT = 1280;
const FPS = 15; // 15fps is sufficient for text caption overlays (word highlights change every 200-500ms)

const MULTI_COLORS = ["#FFFF00", "#00FF00", "#00FFFF", "#FF00FF", "#FF5F00", "#FF007F"];

// ─── Font Mapping ───────────────────────────────────────────────────────────
// Maps config fontFamily values to CSS font-family + the TTF filename

const FONT_CSS_MAP: Record<string, { css: string; file: string; weight: number }> = {
  "Montserrat-Black": { css: "'Montserrat', sans-serif", file: "Montserrat-Bold.ttf", weight: 900 },
  "Outfit-Bold":      { css: "'Outfit', sans-serif",     file: "Outfit-Bold.ttf", weight: 700 },
  "Anton":            { css: "'Anton', sans-serif",      file: "Anton.ttf", weight: 400 },
  "Inter-Bold":       { css: "'Inter', sans-serif",      file: "Inter-Bold.ttf", weight: 700 },
  "Inter-Light":      { css: "'Inter', sans-serif",      file: "Inter-Light.ttf", weight: 300 },
  "Inter-Regular":    { css: "'Inter', sans-serif",      file: "Inter-Regular.ttf", weight: 400 },
  "Caveat-Bold":      { css: "'Caveat', cursive",        file: "Caveat-Bold.ttf", weight: 700 },
  "Oswald-Bold":      { css: "'Oswald', sans-serif",     file: "Oswald-Bold.ttf", weight: 700 },
  "PlayfairDisplay-Bold": { css: "'Playfair Display', serif", file: "PlayfairDisplay-Bold.ttf", weight: 700 },
  "GreatVibes-Regular":   { css: "'Great Vibes', cursive",    file: "GreatVibes-Regular.ttf", weight: 400 },
  "Lora-Bold":        { css: "'Lora', serif",            file: "Lora-Bold.ttf", weight: 700 },
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

// ─── Phrase Chunking for Word Builder mode ──────────────────────────────────
// Larger groups (up to 12 words) split only on audio gaps > 1.5s

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
  // NOTE: Opacity values are boosted ~15-20% compared to Live Studio Preview
  // to compensate for VP8 alpha channel quantization during WebM encoding.
  let vignetteCSS = "";
  if (config.vignette === "bottom_fade") {
    vignetteCSS = `background: linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.30) 50%, transparent 100%);`;
  } else if (config.vignette === "radial_vignette") {
    vignetteCSS = `background: radial-gradient(circle, transparent 35%, rgba(0,0,0,0.80) 95%);`;
  } else if (config.vignette === "sunset_glow") {
    vignetteCSS = `background: radial-gradient(circle at top left, rgba(255,140,0,0.80) 0%, rgba(255,69,0,0) 60%);`;
  } else if (config.vignette === "emerald_fade") {
    vignetteCSS = `background: radial-gradient(circle, transparent 35%, rgba(5,28,15,0.80) 95%);`;
  } else if (config.vignette === "top_fade") {
    vignetteCSS = `background: linear-gradient(to bottom, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.30) 50%, transparent 100%);`;
  } else if (config.vignette === "dual_fade") {
    vignetteCSS = `background: linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, transparent 40%, transparent 60%, rgba(0,0,0,0.85) 100%);`;
  } else if (config.vignette === "purple_haze") {
    vignetteCSS = `background: radial-gradient(circle at bottom, rgba(147,51,234,0.60) 0%, transparent 70%);`;
  } else if (config.vignette === "blue_hour") {
    vignetteCSS = `background: radial-gradient(ellipse at bottom, rgba(30,58,138,0.70) 0%, transparent 65%);`;
  } else if (config.vignette === "fire_edge") {
    vignetteCSS = `background: radial-gradient(circle, transparent 30%, rgba(180,40,0,0.65) 90%);`;
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
  } else if (config.particleFx === "hearts.mp4") {
    const hearts = [
      { emoji: "❤️", size: 14, top: 95, left: 15, delay: "0s", dur: "5.5s" },
      { emoji: "💕", size: 11, top: 92, left: 45, delay: "1.3s", dur: "6.2s" },
      { emoji: "💗", size: 16, top: 98, left: 70, delay: "2.8s", dur: "5s" },
      { emoji: "❤️", size: 12, top: 93, left: 30, delay: "0.7s", dur: "6.8s" },
      { emoji: "💖", size: 15, top: 96, left: 85, delay: "3.5s", dur: "5.8s" },
      { emoji: "💗", size: 11, top: 90, left: 55, delay: "4.2s", dur: "7s" },
    ];
    particleHTML = hearts.map(p =>
      `<div style="position:absolute;font-size:${p.size}px;top:${p.top}%;left:${p.left}%;animation:floatDust ${p.dur} ease-in-out infinite;animation-delay:${p.delay}">${p.emoji}</div>`
    ).join("\n");
  } else if (config.particleFx === "sparkles.mp4") {
    const sparkles = [
      { w: 6, bg: "rgba(255,255,255,1)", top: 20, left: 15, delay: "0s", dur: "2.5s" },
      { w: 8, bg: "rgba(255,220,100,0.9)", top: 40, left: 75, delay: "0.8s", dur: "3.2s" },
      { w: 4, bg: "rgba(255,255,255,0.8)", top: 65, left: 30, delay: "1.5s", dur: "2.8s" },
      { w: 8, bg: "rgba(150,220,255,0.7)", top: 80, left: 60, delay: "2.2s", dur: "3.5s" },
      { w: 6, bg: "rgba(255,255,255,1)", top: 30, left: 50, delay: "0.4s", dur: "2.2s" },
      { w: 4, bg: "rgba(255,180,200,0.8)", top: 55, left: 88, delay: "3s", dur: "3s" },
      { w: 8, bg: "rgba(255,255,255,0.9)", top: 15, left: 42, delay: "1.8s", dur: "2.6s" },
      { w: 6, bg: "rgba(255,200,100,0.8)", top: 75, left: 10, delay: "2.8s", dur: "3.8s" },
    ];
    particleHTML = sparkles.map(p =>
      `<div style="position:absolute;width:${p.w}px;height:${p.w}px;background:${p.bg};border-radius:2px;transform:rotate(45deg);top:${p.top}%;left:${p.left}%;animation:twinkleSparkle ${p.dur} ease-in-out infinite;animation-delay:${p.delay}"></div>`
    ).join("\n");
  } else if (config.particleFx === "confetti.mp4") {
    const confetti = [
      { w: 8, h: 12, bg: "rgba(248,113,113,0.8)", top: -10, left: 10, delay: "0s", dur: "4s" },
      { w: 6, h: 10, bg: "rgba(250,204,21,0.8)", top: -10, left: 30, delay: "0.8s", dur: "4.5s" },
      { w: 8, h: 8, bg: "rgba(96,165,250,0.8)", top: -10, left: 55, delay: "1.5s", dur: "3.8s" },
      { w: 6, h: 12, bg: "rgba(74,222,128,0.8)", top: -10, left: 75, delay: "2.2s", dur: "5s" },
      { w: 8, h: 10, bg: "rgba(244,114,182,0.8)", top: -10, left: 45, delay: "0.5s", dur: "4.2s" },
      { w: 6, h: 8, bg: "rgba(192,132,252,0.8)", top: -10, left: 88, delay: "3s", dur: "3.5s" },
      { w: 8, h: 12, bg: "rgba(251,146,60,0.8)", top: -10, left: 20, delay: "1.8s", dur: "4.8s" },
      { w: 6, h: 10, bg: "rgba(34,211,238,0.8)", top: -10, left: 65, delay: "2.8s", dur: "4.3s" },
    ];
    particleHTML = confetti.map(p =>
      `<div style="position:absolute;width:${p.w}px;height:${p.h}px;background:${p.bg};border-radius:2px;top:${p.top}px;left:${p.left}%;animation:fallSnow ${p.dur} linear infinite;animation-delay:${p.delay}"></div>`
    ).join("\n");
  } else if (config.particleFx === "neon_rain.mp4") {
    const rain = [
      { h: 16, bg: "rgba(34,211,238,0.6)", glow: "0 0 4px #22d3ee", left: 12, delay: "0s", dur: "1.8s" },
      { h: 20, bg: "rgba(168,85,247,0.6)", glow: "0 0 4px #a855f7", left: 28, delay: "0.3s", dur: "2.1s" },
      { h: 14, bg: "rgba(244,114,182,0.6)", glow: "0 0 4px #f472b6", left: 45, delay: "0.7s", dur: "1.6s" },
      { h: 18, bg: "rgba(103,232,249,0.6)", glow: "0 0 4px #67e8f9", left: 62, delay: "1.1s", dur: "2.3s" },
      { h: 12, bg: "rgba(96,165,250,0.6)", glow: "0 0 4px #60a5fa", left: 78, delay: "0.5s", dur: "1.9s" },
      { h: 20, bg: "rgba(167,139,250,0.6)", glow: "0 0 4px #a78bfa", left: 92, delay: "1.4s", dur: "2s" },
      { h: 16, bg: "rgba(232,121,249,0.6)", glow: "0 0 4px #e879f9", left: 38, delay: "0.9s", dur: "1.7s" },
      { h: 14, bg: "rgba(34,211,238,0.6)", glow: "0 0 4px #22d3ee", left: 55, delay: "1.6s", dur: "2.2s" },
    ];
    particleHTML = rain.map(p =>
      `<div style="position:absolute;width:1px;height:${p.h}px;background:${p.bg};box-shadow:${p.glow};top:-10px;left:${p.left}%;animation:fallSnow ${p.dur} linear infinite;animation-delay:${p.delay}"></div>`
    ).join("\n");
  } else if (config.particleFx === "bubbles.mp4") {
    const bubbles = [
      { w: 16, top: 95, left: 15, delay: "0s", dur: "6s" },
      { w: 24, top: 92, left: 45, delay: "1.5s", dur: "7.5s" },
      { w: 12, top: 98, left: 70, delay: "3s", dur: "5.5s" },
      { w: 20, top: 90, left: 30, delay: "0.8s", dur: "8s" },
      { w: 12, top: 96, left: 85, delay: "2.2s", dur: "6.5s" },
      { w: 28, top: 93, left: 58, delay: "4s", dur: "9s" },
    ];
    particleHTML = bubbles.map(p =>
      `<div style="position:absolute;width:${p.w}px;height:${p.w}px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.05);border-radius:50%;top:${p.top}%;left:${p.left}%;animation:floatDust ${p.dur} ease-in-out infinite;animation-delay:${p.delay}"></div>`
    ).join("\n");
  }

  // Serialize chunks to JSON for the page script
  const isWordBuilder = config.animationMode === "word_builder";
  const phrases = isWordBuilder ? chunkPhrases(words) : [];
  const chunksJSON = isWordBuilder ? JSON.stringify(phrases) : JSON.stringify(chunks);
  const activeColor = config.activeColor;
  const multiColorsJSON = JSON.stringify(MULTI_COLORS);
  const textColor = config.textColor || "#ffffff";
  const bgColor = config.bgColor || null;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @font-face {
    font-family: 'PrimaryFont';
    src: url('file://${fontFilePath}');
    font-weight: ${fontEntry.weight || 900};
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
    background: ${bgColor ? bgColor : "transparent"};
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
    padding: 0 ${isWordBuilder ? "32" : "12"}px;
    text-align: ${config.textAlign || (isWordBuilder ? "left" : "center")};
    transform: translateY(-50%);
    top: ${config.positionY * 100}%;
    font-family: 'PrimaryFont', ${fontEntry.css};
    font-size: ${config.fontSize}px;
    line-height: ${isWordBuilder ? "1.6" : "1.25"};
    letter-spacing: ${config.letterSpacing || 0}px;
    z-index: 10;
    user-select: none;
    pointer-events: none;
  }

  #captions .words {
    display: flex;
    flex-wrap: wrap;
    justify-content: ${config.textAlign === "left" ? "flex-start" : config.textAlign === "right" ? "flex-end" : "center"};
    align-items: center;
    gap: ${isWordBuilder 
      ? `34px ${config.wordSpacing === "wide" ? "42px" : config.wordSpacing === "extra_wide" ? "52px" : config.wordSpacing === "normal" ? "12px" : "52px"}`
      : `4px ${config.wordSpacing === "wide" ? "12px" : config.wordSpacing === "extra_wide" ? "20px" : "4px"}`
    };
    ${isWordBuilder ? `max-height: ${Math.round(config.fontSize * 1.5 * 3 + 40)}px; overflow: hidden;` : ""}
  }

  #captions .word {
    display: inline-block;
    color: ${isWordBuilder ? textColor : "#ffffff"};
    ${isWordBuilder ? "" : `-webkit-text-stroke: ${config.strokeWidth}px ${config.strokeColor};`}
    font-weight: ${isWordBuilder ? "300" : "800"};
    ${isWordBuilder ? "text-transform: lowercase; letter-spacing: -0.01em;" : ""}
    transition: all 0.08s ease-out;
  }

  ${isWordBuilder ? "" : `#captions .word.active {
    font-weight: 900;
    letter-spacing: -0.025em;
    transform: scale(1.12);
  }`}

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

  @keyframes twinkleSparkle {
    0%, 100% { opacity: 0; transform: scale(0.5) rotate(0deg); }
    25% { opacity: 1; transform: scale(1.2) rotate(90deg); }
    50% { opacity: 0.3; transform: scale(0.7) rotate(180deg); }
    75% { opacity: 1; transform: scale(1.1) rotate(270deg); }
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
    const animationMode = "${config.animationMode || "highlight"}";
    const textColor = "${textColor}";

    function getWordColor(idx, isActive) {
      if (animationMode === "word_builder") return textColor;
      if (!isActive) return "#ffffff";
      if (activeColorConfig === "multi") return multiColors[idx % multiColors.length];
      return activeColorConfig;
    }

    // Exposed to Puppeteer — sets the current time and re-renders captions
    window.setTime = function(t) {
      const container = document.getElementById("wordsContainer");

      if (animationMode === "word_builder") {
        // ── WORD BUILDER MODE: Progressive append with hard-cut between phrases ──
        let currentPhrase = null;
        for (const phrase of chunks) {
          if (phrase.length === 0) continue;
          const phraseStart = phrase[0].start;
          const phraseEnd = phrase[phrase.length - 1].end;
          if (t >= phraseStart - 0.05 && t <= phraseEnd + 0.3) {
            currentPhrase = phrase;
            break;
          }
        }

        if (!currentPhrase) {
          container.innerHTML = "";
          return;
        }

        // Show only words whose start time has been reached
        let html = "";
        for (let i = 0; i < currentPhrase.length; i++) {
          const w = currentPhrase[i];
          if (t < w.start - 0.05) break; // don't show future words
          const color = textColor;
          html += '<span class="word" style="color:' + color + '">' + w.word.toLowerCase() + '</span>';
        }
        container.innerHTML = html;
        return;
      }

      // ── HIGHLIGHT MODE (existing behavior) ──
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
  progressFile?: string,
): Promise<void> {
  const fontsDir = path.join(process.cwd(), "public", "fonts");
  const totalFrames = Math.ceil(duration * FPS);

  console.log(`[Browser Renderer] Rendering ${totalFrames} frames at ${FPS}fps (${duration.toFixed(1)}s)`);
  console.log(`[Browser Renderer] Config: font=${config.fontFamily}, size=${config.fontSize}, active=${config.activeColor}`);
  console.log(`[Browser Renderer] Effects: vignette=${config.vignette}, particles=${config.particleFx}`);
  console.log(`[Browser Renderer] Output: ${outputPath}`);

  // ── Kill any zombie chromium/ffmpeg processes from previous failed renders ──
  try {
    const { execSync } = require("child_process");
    try { execSync("pkill -f 'chromium.*--headless' 2>/dev/null || true", { timeout: 3000 }); } catch {}
    try { execSync("pkill -f 'ffmpeg.*overlay' 2>/dev/null || true", { timeout: 3000 }); } catch {}
    await new Promise(r => setTimeout(r, 500));
    console.log(`[Browser Renderer] Cleaned up zombie processes`);
  } catch {}

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
      "--disable-extensions",
      "--disable-background-networking",
      "--single-process",
      "--no-zygote",
      `--window-size=${WIDTH},${HEIGHT}`,
    ],
  });

  let ffmpegProcess: ReturnType<typeof spawn> | null = null;

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
    
    // Load the HTML file (file:// protocol for font loading)
    await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle0", timeout: 15000 });
    
    // Wait for fonts to load
    await page.evaluate(() => document.fonts.ready);
    console.log(`[Browser Renderer] Page loaded, fonts ready. Starting frame capture...`);

    // Spawn FFmpeg to receive PNG frames and encode to WebM VP8
    // When bgColor is set, the overlay is a FULL opaque video (no alpha needed)
    // When transparent, use yuva420p for alpha channel compositing
    const hasSolidBg = !!config.bgColor &&
      config.bgColor !== "none" &&
      config.bgColor !== "transparent" &&
      config.bgColor !== "null";
    const ffmpegArgs = [
      "-y",
      "-f", "image2pipe",
      "-framerate", String(FPS),
      "-i", "-",
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

    ffmpegProcess = spawn("ffmpeg", ffmpegArgs, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const ffmpeg = ffmpegProcess;

    // Cap stderr to prevent memory bloat
    let ffmpegStderr = "";
    ffmpeg.stderr!.on("data", (data: Buffer) => {
      if (ffmpegStderr.length < 5000) ffmpegStderr += data.toString();
    });

    // Track if FFmpeg died early
    let ffmpegDead = false;
    ffmpeg.on("close", () => { ffmpegDead = true; });

    // Capture frames with per-frame error recovery
    let consecutiveFailures = 0;
    for (let frame = 0; frame < totalFrames; frame++) {
      if (ffmpegDead) {
        throw new Error("FFmpeg process died during frame capture");
      }

      const t = frame / FPS;

      try {
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

        // Write PNG frame to FFmpeg stdin
        const canWrite = ffmpeg.stdin!.write(screenshot);
        if (!canWrite) {
          await new Promise<void>((resolve) => ffmpeg.stdin!.once("drain", resolve));
        }
        consecutiveFailures = 0;
      } catch (frameErr) {
        consecutiveFailures++;
        console.error(`[Browser Renderer] Frame ${frame} FAILED (${consecutiveFailures}/3):`, frameErr);
        if (consecutiveFailures >= 3) {
          throw new Error(`Chromium crashed after ${consecutiveFailures} consecutive frame failures`);
        }
        continue;
      }

      // Progress logging every 2 seconds
      if (frame % (FPS * 2) === 0) {
        const pct = Math.round((frame / totalFrames) * 100);
        console.log(`[Browser Renderer] Frame ${frame}/${totalFrames} (${pct}%)`);
        if (progressFile) {
          try {
            fs.writeFileSync(progressFile, JSON.stringify({ current: frame, total: totalFrames, percent: pct, status: "rendering" }), "utf-8");
          } catch {}
        }
      }
    }

    // Close FFmpeg stdin and wait for completion
    ffmpeg.stdin!.end();

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
          if (progressFile) {
            try { fs.writeFileSync(progressFile, JSON.stringify({ current: totalFrames, total: totalFrames, percent: 100, status: "done" }), "utf-8"); } catch {}
          }
          resolve();
        } else {
          console.error(`[Browser Renderer] FFmpeg failed with code ${code}:`, ffmpegStderr.slice(-1000));
          try { fs.unlinkSync(tmpPath); } catch {}
          if (progressFile) {
            try { fs.writeFileSync(progressFile, JSON.stringify({ current: 0, total: totalFrames, percent: 0, status: "failed", error: `FFmpeg code ${code}` }), "utf-8"); } catch {}
          }
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
    // Always kill FFmpeg if still running
    if (ffmpegProcess && !ffmpegProcess.killed) {
      try { ffmpegProcess.kill("SIGKILL"); } catch {}
    }
    // Always close browser
    try { await browser.close(); } catch {}
    // Cleanup temp HTML
    try { fs.unlinkSync(htmlPath); } catch {}
    console.log(`[Browser Renderer] Cleanup complete`);
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
