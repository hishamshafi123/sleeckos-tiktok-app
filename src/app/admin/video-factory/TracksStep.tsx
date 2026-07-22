"use client";

import React, { useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  ListMusic,
  Loader2,
  Music,
  Plus,
  Search,
} from "lucide-react";

/**
 * TracksStep — lyric-mode content for wizard step 2.
 *
 * Reuses the genres lyric-generator endpoints directly (LRCLIB search → pick a
 * synced version → click start/end lines to set the trim window → pick a
 * YouTube audio candidate → download). The assembled track is persisted via
 * POST /api/factory/tracks (which only stores the result — audio stays
 * untrimmed, the worker applies trimStart/trimEnd at render time and shifts
 * lyric timings to 0).
 */

export interface FactoryTrackRow {
  id: string;
  title: string;
  artist: string | null;
  duration: number;
  trimStart: number;
  trimEnd: number | null;
  maxReuse: number | null;
  audioRef: string | null;
  lineCount: number;
  timesUsed: number;
}

interface LrcLine {
  text: string;
  start: number;
  end: number;
  index: number;
}

interface LrclibVersion {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  syncedLyrics: string;
  parsedLines: LrcLine[];
}

interface YouTubeCandidate {
  videoId: string;
  title: string;
  duration: number;
  channel: string;
  url: string;
}

/** Client-side .lrc parser (manual paste fallback) — same format as the service parser. */
function parseLrcClient(lrcText: string): LrcLine[] {
  if (!lrcText) return [];
  const timeRegex = /\[(\d+):(\d+(?:\.\d+)?)]/;
  const lines: LrcLine[] = [];
  let idx = 0;
  for (const raw of lrcText.split("\n")) {
    const match = timeRegex.exec(raw);
    if (!match) continue;
    const t = parseInt(match[1], 10) * 60 + parseFloat(match[2]);
    lines.push({ text: raw.replace(timeRegex, "").trim(), start: t, end: 0, index: idx++ });
  }
  lines.sort((a, b) => a.start - b.start);
  lines.forEach((l, i) => {
    l.index = i;
    l.end = i < lines.length - 1 ? lines[i + 1].start : l.start + 4.0;
  });
  return lines;
}

function fmtTime(secs: number): string {
  if (!Number.isFinite(secs)) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function TracksStep(props: {
  tracks: FactoryTrackRow[];
  tracksLoading: boolean;
  selectedIds: string[];
  onToggleTrack: (id: string) => void;
  onTrackSaved: (track: FactoryTrackRow) => void;
}) {
  const { tracks, tracksLoading, selectedIds, onToggleTrack, onTrackSaved } = props;

  // Add-track draft state
  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [lrclibVersions, setLrclibVersions] = useState<LrclibVersion[]>([]);
  const [ytCandidates, setYtCandidates] = useState<YouTubeCandidate[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const [lines, setLines] = useState<LrcLine[]>([]);
  const [startLine, setStartLine] = useState<number | null>(null);
  const [endLine, setEndLine] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [audioRef, setAudioRef] = useState("");
  const [audioLabel, setAudioLabel] = useState("");
  const [downloadingVideoId, setDownloadingVideoId] = useState<string | null>(null);
  const [maxReuse, setMaxReuse] = useState("");
  const [manualLrc, setManualLrc] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const resetDraft = () => {
    setQuery("");
    setLrclibVersions([]);
    setYtCandidates([]);
    setSelectedVersionId(null);
    setLines([]);
    setStartLine(null);
    setEndLine(null);
    setTitle("");
    setArtist("");
    setAudioRef("");
    setAudioLabel("");
    setMaxReuse("");
    setManualLrc("");
    setManualOpen(false);
  };

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await fetch("/api/managed/genres/lyric-generator/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed");
      const versions = (data.lrclib || []) as LrclibVersion[];
      const youtube = (data.youtube || []) as YouTubeCandidate[];
      setLrclibVersions(versions);
      setYtCandidates(youtube);
      if (versions.length === 0 && youtube.length === 0) {
        toast.error("Nothing found — try another query or paste .lrc manually");
      } else if (versions.length === 0) {
        toast.error("No synced LRCLIB lyrics for this query — paste .lrc manually below");
      }
    } catch (err: any) {
      toast.error(err.message || "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const pickVersion = (v: LrclibVersion) => {
    setSelectedVersionId(v.id);
    setLines(v.parsedLines || []);
    setStartLine(null);
    setEndLine(null);
    if (!title.trim()) setTitle(v.trackName || "");
    if (!artist.trim()) setArtist(v.artistName || "");
    setManualOpen(false);
  };

  const applyManualLrc = () => {
    const parsed = parseLrcClient(manualLrc);
    if (parsed.length === 0) {
      toast.error("No timed lines found — expected [mm:ss.xx] text lines");
      return;
    }
    setSelectedVersionId(null);
    setLines(parsed);
    setStartLine(null);
    setEndLine(null);
    toast.success(`Parsed ${parsed.length} synced lines`);
  };

  // Click start line, then end line (clicking again restarts the range).
  const handleLineClick = (idx: number) => {
    if (startLine === null || (startLine !== null && endLine !== null)) {
      setStartLine(idx);
      setEndLine(null);
    } else if (idx >= startLine) {
      setEndLine(idx);
    } else {
      setStartLine(idx);
      setEndLine(null);
    }
  };

  const handleDownloadAudio = async (candidate: YouTubeCandidate) => {
    if (downloadingVideoId) return;
    setDownloadingVideoId(candidate.videoId);
    try {
      const res = await fetch("/api/managed/genres/lyric-generator/download-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: candidate.videoId, title, artist }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Audio download failed");
      setAudioRef(data.filePath);
      setAudioLabel(candidate.title || candidate.videoId);
      toast.success(`Audio downloaded (${fmtTime(data.duration || 0)})`);
    } catch (err: any) {
      toast.error(err.message || "Audio download failed");
    } finally {
      setDownloadingVideoId(null);
    }
  };

  const trimStart = startLine !== null ? lines[startLine]?.start ?? null : null;
  const effectiveEnd = endLine !== null ? endLine : startLine;
  const trimEnd = effectiveEnd !== null ? lines[effectiveEnd]?.end ?? null : null;
  const canSave =
    !!title.trim() && lines.length > 0 && trimStart !== null && trimEnd !== null && trimEnd > trimStart && !!audioRef && !saving;

  const handleSaveTrack = async () => {
    if (!canSave || trimStart === null || trimEnd === null) return;
    setSaving(true);
    try {
      const res = await fetch("/api/factory/tracks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          artist: artist.trim() || null,
          lrcLines: lines.map((l) => ({ t: l.start, text: l.text })),
          trimStart,
          trimEnd,
          maxReuse: maxReuse.trim() ? Math.max(1, parseInt(maxReuse, 10) || 1) : null,
          audioRef,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save track");
      toast.success(`Track "${data.track.title}" saved`);
      onTrackSaved(data.track as FactoryTrackRow);
      resetDraft();
      setAddOpen(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to save track");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Existing factory tracks */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-[#71717a]">
            Factory Tracks {tracks.length > 0 && <span className="text-[#a1a1aa]">({selectedIds.length} of {tracks.length} selected)</span>}
          </h4>
          <button
            type="button"
            onClick={() => setAddOpen((v) => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#E11D48] hover:bg-[#be123c] text-white text-[11px] font-semibold rounded-lg transition-colors cursor-pointer"
          >
            <Plus className="w-3 h-3" />
            Add Track
            {addOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>

        {tracksLoading ? (
          <div className="flex items-center justify-center py-8 text-[#71717a]">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        ) : tracks.length === 0 ? (
          <div className="bg-[#09090b] border border-[#27272a] rounded-xl p-6 text-center">
            <ListMusic className="w-6 h-6 text-[#3f3f46] mx-auto mb-2" />
            <p className="text-[11px] text-[#71717a]">No factory tracks yet — add one below to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {tracks.map((t) => {
              const isSel = selectedIds.includes(t.id);
              const remaining = t.maxReuse === null ? null : Math.max(0, t.maxReuse - t.timesUsed);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onToggleTrack(t.id)}
                  className={`text-left bg-[#09090b] border rounded-xl px-3 py-2.5 transition-colors cursor-pointer ${
                    isSel ? "border-[#E11D48] bg-[#E11D48]/5" : "border-[#27272a] hover:border-[#3f3f46]"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                      isSel ? "bg-[#E11D48] border-[#E11D48]" : "border-[#3f3f46]"
                    }`}>
                      {isSel && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-semibold text-white truncate">{t.title}</p>
                      <p className="text-[10px] text-[#71717a] truncate">{t.artist || "Unknown artist"}</p>
                    </div>
                    <Music className="w-3.5 h-3.5 text-[#3f3f46] flex-shrink-0" />
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 pl-6 text-[9px] font-mono text-[#71717a]">
                    <span>
                      {fmtTime(t.trimStart)} → {t.trimEnd !== null ? fmtTime(t.trimEnd) : "end"}
                    </span>
                    <span>{t.lineCount} lines</span>
                    <span className={remaining === 0 ? "text-red-400" : ""}>
                      {t.maxReuse === null ? `${t.timesUsed} used · unlimited` : `${remaining}/${t.maxReuse} uses left`}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Add-track panel */}
      {addOpen && (
        <div className="bg-[#09090b] border border-[#27272a] rounded-xl p-4 space-y-4">
          {/* Search */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-[#71717a] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search a song — “Song title artist”…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSearch();
                  }
                }}
                className="w-full bg-[#18181b] border border-[#27272a] rounded-lg pl-8 pr-3 py-2 text-white placeholder-[#71717a] text-[11px] focus:outline-none focus:border-[#E11D48]"
              />
            </div>
            <button
              type="button"
              onClick={handleSearch}
              disabled={searching || !query.trim()}
              className="px-3 py-2 bg-[#27272a] hover:bg-[#3f3f46] disabled:opacity-40 text-white text-[11px] font-semibold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 flex-shrink-0"
            >
              {searching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
              Search
            </button>
          </div>

          {/* Results: LRCLIB versions + YouTube audio candidates */}
          {(lrclibVersions.length > 0 || ytCandidates.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#71717a] mb-1.5">
                  Synced lyrics (LRCLIB) — pick one version
                </p>
                <div className="space-y-1.5 max-h-[220px] overflow-y-auto custom-scrollbar pr-1">
                  {lrclibVersions.length === 0 && (
                    <p className="text-[10px] text-[#71717a] italic px-1">No synced versions found.</p>
                  )}
                  {lrclibVersions.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => pickVersion(v)}
                      className={`w-full text-left border rounded-lg px-2.5 py-2 transition-colors cursor-pointer ${
                        selectedVersionId === v.id
                          ? "border-[#E11D48] bg-[#E11D48]/5"
                          : "border-[#27272a] bg-[#18181b] hover:border-[#3f3f46]"
                      }`}
                    >
                      <p className="text-[11px] font-semibold text-white truncate">
                        {v.trackName} <span className="font-normal text-[#a1a1aa]">— {v.artistName}</span>
                      </p>
                      <p className="text-[9px] font-mono text-[#71717a]">
                        {v.albumName || "Unknown album"} · {fmtTime(v.duration)} · {(v.parsedLines || []).length} lines
                      </p>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#71717a] mb-1.5">
                  Audio (YouTube) — pick one to download
                </p>
                <div className="space-y-1.5 max-h-[220px] overflow-y-auto custom-scrollbar pr-1">
                  {ytCandidates.length === 0 && (
                    <p className="text-[10px] text-[#71717a] italic px-1">No audio candidates found.</p>
                  )}
                  {ytCandidates.map((c) => {
                    const isActive = audioRef && audioLabel === (c.title || c.videoId);
                    return (
                      <div
                        key={c.videoId}
                        className={`border rounded-lg px-2.5 py-2 flex items-center gap-2 ${
                          isActive ? "border-green-500/50 bg-green-500/5" : "border-[#27272a] bg-[#18181b]"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-semibold text-white truncate">{c.title}</p>
                          <p className="text-[9px] font-mono text-[#71717a] truncate">
                            {c.channel} · {fmtTime(c.duration)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDownloadAudio(c)}
                          disabled={downloadingVideoId !== null}
                          className={`px-2 py-1.5 text-[10px] font-semibold rounded-lg transition-colors cursor-pointer flex items-center gap-1 flex-shrink-0 ${
                            isActive
                              ? "bg-green-500/20 text-green-400"
                              : "bg-[#27272a] hover:bg-[#3f3f46] text-white disabled:opacity-40"
                          }`}
                        >
                          {downloadingVideoId === c.videoId ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : isActive ? (
                            <Check className="w-3 h-3" />
                          ) : (
                            <Download className="w-3 h-3" />
                          )}
                          {isActive ? "Downloaded" : "Use audio"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Manual .lrc fallback */}
          <div className="border border-[#27272a] rounded-lg">
            <button
              type="button"
              onClick={() => setManualOpen((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-semibold text-[#a1a1aa] hover:text-white transition-colors cursor-pointer"
            >
              <span>Manual .lrc paste (fallback when LRCLIB has no synced lyrics)</span>
              {manualOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {manualOpen && (
              <div className="px-3 pb-3 space-y-2">
                <textarea
                  value={manualLrc}
                  onChange={(e) => setManualLrc(e.target.value)}
                  placeholder={"[00:12.50] First lyric line\n[00:15.20] Second lyric line\n…"}
                  rows={5}
                  className="w-full bg-[#18181b] border border-[#27272a] rounded-lg px-3 py-2 text-white placeholder-[#71717a] text-[11px] font-mono focus:outline-none focus:border-[#E11D48] resize-y"
                />
                <button
                  type="button"
                  onClick={applyManualLrc}
                  disabled={!manualLrc.trim()}
                  className="px-3 py-1.5 bg-[#27272a] hover:bg-[#3f3f46] disabled:opacity-40 text-white text-[11px] font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  Parse {manualLrc.trim() ? `${manualLrc.split("\n").filter((l) => /\[\d+:\d+/.test(l)).length} timed lines` : ".lrc"}
                </button>
              </div>
            )}
          </div>

          {/* Line trim: click start + end line */}
          {lines.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#71717a]">
                  Click a start line, then an end line ({lines.length} lines)
                </p>
                {trimStart !== null && trimEnd !== null && (
                  <p className="text-[10px] font-mono text-green-400">
                    Trim {fmtTime(trimStart)} → {fmtTime(trimEnd)} · {Math.max(1, Math.round(trimEnd - trimStart))}s ·{" "}
                    {(endLine !== null ? endLine : startLine!) - startLine! + 1} lines
                  </p>
                )}
              </div>
              <div className="max-h-[240px] overflow-y-auto custom-scrollbar border border-[#27272a] rounded-lg divide-y divide-[#18181b]">
                {lines.map((l, idx) => {
                  const inRange =
                    startLine !== null && idx >= startLine && (endLine === null ? idx === startLine : idx <= endLine);
                  const isEdge = idx === startLine || idx === endLine;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleLineClick(idx)}
                      className={`w-full flex items-center gap-3 px-3 py-1.5 text-left transition-colors cursor-pointer ${
                        isEdge
                          ? "bg-[#E11D48]/15 text-white"
                          : inRange
                            ? "bg-[#E11D48]/5 text-[#e4e4e7]"
                            : "text-[#a1a1aa] hover:bg-[#18181b]"
                      }`}
                    >
                      <span className="text-[9px] font-mono text-[#71717a] w-12 flex-shrink-0">{fmtTime(l.start)}</span>
                      <span className="text-[11px] truncate flex-1">{l.text || "—"}</span>
                      {idx === startLine && (
                        <span className="text-[8px] font-bold uppercase text-[#E11D48] flex-shrink-0">start</span>
                      )}
                      {idx === endLine && (
                        <span className="text-[8px] font-bold uppercase text-[#E11D48] flex-shrink-0">end</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Track meta + save */}
          {lines.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <input
                type="text"
                placeholder="Track title *"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="bg-[#18181b] border border-[#27272a] rounded-lg px-3 py-2 text-white placeholder-[#71717a] text-[11px] focus:outline-none focus:border-[#E11D48]"
              />
              <input
                type="text"
                placeholder="Artist"
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                className="bg-[#18181b] border border-[#27272a] rounded-lg px-3 py-2 text-white placeholder-[#71717a] text-[11px] focus:outline-none focus:border-[#E11D48]"
              />
              <input
                type="number"
                min={1}
                placeholder="Max reuse (blank = unlimited)"
                value={maxReuse}
                onChange={(e) => setMaxReuse(e.target.value)}
                className="bg-[#18181b] border border-[#27272a] rounded-lg px-3 py-2 text-white placeholder-[#71717a] text-[11px] focus:outline-none focus:border-[#E11D48]"
              />
              <button
                type="button"
                onClick={handleSaveTrack}
                disabled={!canSave}
                className="py-2 bg-[#E11D48] hover:bg-[#be123c] disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] font-bold rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                Save Track
              </button>
            </div>
          )}
          {lines.length > 0 && !audioRef && (
            <p className="text-[10px] text-amber-400 flex items-center gap-1.5">
              <AlertCircle className="w-3 h-3 flex-shrink-0" />
              Download audio from a YouTube candidate above before saving — the track needs an audio source.
            </p>
          )}
        </div>
      )}

      <p className="text-[10px] text-[#71717a] leading-relaxed">
        Tracks distribute round-robin across videos, respecting each track&apos;s max-reuse cap. If a song has no
        synced lyrics anywhere, transcribe it with Whisper (stable-ts) in the Genres lyric generator first, then add
        it here via manual .lrc paste. The worker trims the audio to your line range at render time and shifts lyric
        timings to 0.
      </p>
    </div>
  );
}
