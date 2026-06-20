/**
 * Audio Sourcer Service
 * 
 * Handles YouTube audio search/download via yt-dlp and audio trimming via FFmpeg.
 * yt-dlp runs from the Python venv installed in Docker.
 */

import { execFile } from "child_process";
import path from "path";
import fs from "fs";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// ── Types ────────────────────────────────────────────────────────────────────

export interface YouTubeSearchResult {
  videoId: string;
  title: string;
  duration: number; // seconds
  channel: string;
  thumbnail: string;
  url: string;
}

// ── yt-dlp Binary Resolution ─────────────────────────────────────────────────

function getYtDlpPath(): string {
  // In Docker, yt-dlp is installed in the Python venv
  const venvPath = path.join(process.cwd(), "venv", "bin", "yt-dlp");
  if (fs.existsSync(venvPath)) return venvPath;
  
  // Fallback: system-installed yt-dlp
  return "yt-dlp";
}

// ── YouTube Audio Search ─────────────────────────────────────────────────────

/**
 * Search YouTube for audio tracks matching a query.
 * Uses yt-dlp --dump-json to get metadata without downloading.
 */
export async function searchYouTubeAudio(
  query: string,
  limit: number = 5
): Promise<YouTubeSearchResult[]> {
  const ytdlp = getYtDlpPath();
  
  try {
    const { stdout } = await execFileAsync(ytdlp, [
      `ytsearch${limit}:${query}`,
      "--dump-json",
      "--no-download",
      "--no-playlist",
      "--quiet",
      "--no-warnings",
    ], {
      timeout: 30000, // 30s timeout
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    // yt-dlp outputs one JSON object per line
    const results: YouTubeSearchResult[] = [];
    for (const line of stdout.split("\n").filter(Boolean)) {
      try {
        const data = JSON.parse(line);
        results.push({
          videoId: data.id || "",
          title: data.title || data.fulltitle || "",
          duration: data.duration || 0,
          channel: data.channel || data.uploader || "",
          thumbnail: data.thumbnail || data.thumbnails?.[0]?.url || "",
          url: `https://www.youtube.com/watch?v=${data.id}`,
        });
      } catch {
        // Skip malformed JSON lines
      }
    }

    return results;
  } catch (err: any) {
    console.error("[AudioSourcer] yt-dlp search error:", err.message);
    throw new Error(`YouTube search failed: ${err.message}`);
  }
}

/**
 * Search YouTube by direct URL (when user pastes a link).
 */
export async function getYouTubeVideoInfo(url: string): Promise<YouTubeSearchResult> {
  const ytdlp = getYtDlpPath();
  
  const { stdout } = await execFileAsync(ytdlp, [
    url,
    "--dump-json",
    "--no-download",
    "--no-playlist",
    "--quiet",
    "--no-warnings",
  ], {
    timeout: 15000,
    maxBuffer: 5 * 1024 * 1024,
  });

  const data = JSON.parse(stdout.trim().split("\n")[0]);
  return {
    videoId: data.id || "",
    title: data.title || "",
    duration: data.duration || 0,
    channel: data.channel || data.uploader || "",
    thumbnail: data.thumbnail || "",
    url: `https://www.youtube.com/watch?v=${data.id}`,
  };
}

// ── YouTube Audio Download ───────────────────────────────────────────────────

/**
 * Download audio from a YouTube video as MP3.
 * Returns the local file path.
 */
export async function downloadYouTubeAudio(
  videoId: string,
  outputDir?: string
): Promise<{ filePath: string; fileName: string; duration: number }> {
  const ytdlp = getYtDlpPath();
  const dir = outputDir || path.join(process.cwd(), "public", "uploads", "tracks");
  
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const fileName = `yt_${videoId}_${Date.now()}.mp3`;
  const outputPath = path.join(dir, fileName);

  try {
    await execFileAsync(ytdlp, [
      `https://www.youtube.com/watch?v=${videoId}`,
      "-x",
      "--audio-format", "mp3",
      "--audio-quality", "0",
      "-o", outputPath.replace(".mp3", ".%(ext)s"),
      "--no-playlist",
      "--quiet",
      "--no-warnings",
    ], {
      timeout: 120000, // 2 min timeout for download
      maxBuffer: 5 * 1024 * 1024,
    });

    // yt-dlp may output with slightly different extension, find the actual file
    const actualPath = findDownloadedFile(dir, `yt_${videoId}_`);
    
    // Get duration via ffprobe
    let duration = 0;
    try {
      const { stdout: probeOut } = await execFileAsync("ffprobe", [
        "-v", "quiet",
        "-show_entries", "format=duration",
        "-of", "csv=p=0",
        actualPath
      ], { timeout: 10000 });
      duration = parseFloat(probeOut.trim()) || 0;
    } catch {
      // Duration probe failed, non-critical
    }

    const finalName = path.basename(actualPath);
    return {
      filePath: `/uploads/tracks/${finalName}`,
      fileName: finalName,
      duration,
    };
  } catch (err: any) {
    console.error("[AudioSourcer] yt-dlp download error:", err.message);
    throw new Error(`Audio download failed: ${err.message}`);
  }
}

function findDownloadedFile(dir: string, prefix: string): string {
  const files = fs.readdirSync(dir).filter(f => f.startsWith(prefix));
  if (files.length === 0) {
    throw new Error(`No downloaded file found with prefix ${prefix}`);
  }
  // Return the most recently modified
  return path.join(dir, files.sort().pop()!);
}

// ── Audio Trimming ───────────────────────────────────────────────────────────

/**
 * Trim an audio file to a specific time range using FFmpeg.
 * Returns the path to the trimmed file.
 */
export async function trimAudio(
  inputPath: string,
  startTime: number,
  endTime: number,
  outputDir?: string
): Promise<{ filePath: string; fileName: string; duration: number }> {
  const dir = outputDir || path.join(process.cwd(), "public", "uploads", "tracks");
  
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Resolve input path (may be relative /uploads/... or absolute)
  const resolvedInput = inputPath.startsWith("/uploads")
    ? path.join(process.cwd(), "public", inputPath)
    : inputPath;

  if (!fs.existsSync(resolvedInput)) {
    throw new Error(`Input audio file not found: ${resolvedInput}`);
  }

  const duration = endTime - startTime;
  const fileName = `trimmed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp3`;
  const outputPath = path.join(dir, fileName);

  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-ss", String(startTime),
      "-t", String(duration),
      "-i", resolvedInput,
      "-c", "copy",
      "-avoid_negative_ts", "1",
      outputPath,
    ], {
      timeout: 30000,
    });

    return {
      filePath: `/uploads/tracks/${fileName}`,
      fileName,
      duration,
    };
  } catch (err: any) {
    console.error("[AudioSourcer] FFmpeg trim error:", err.message);
    throw new Error(`Audio trim failed: ${err.message}`);
  }
}
