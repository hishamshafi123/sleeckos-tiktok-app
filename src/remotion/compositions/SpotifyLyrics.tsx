import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

export interface SpotifyLyricsProps {
  textColor?: string;
  activeTextColor?: string;
  fontSize?: number;
  albumArtUrl?: string;
  showProgressBar?: boolean;
  lyricsJson?: string;
}

const defaultLyrics = [
  { text: "And I wonder if you know", start: 0, end: 3.0 },
  { text: "How it felt to let you go", start: 3.0, end: 6.5 },
  { text: "All the things we couldn't say", start: 6.5, end: 10.0 },
  { text: "Lost inside another day", start: 10.0, end: 15.0 }
];

export const SpotifyLyricsComposition: React.FC<SpotifyLyricsProps> = ({
  textColor = "#ffffff",
  activeTextColor = "#1db954",
  fontSize = 32,
  albumArtUrl = "",
  showProgressBar = true,
  lyricsJson = "",
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const currentTime = frame / fps;
  const totalDuration = durationInFrames / fps;

  let lines = defaultLyrics;
  if (lyricsJson) {
    try {
      lines = JSON.parse(lyricsJson);
    } catch (e) {
      console.error("[Spotify Lyrics Remotion] JSON parse error:", e);
    }
  }

  // Find current active line index
  const activeIndex = lines.findIndex(
    (line: any) => currentTime >= line.start && currentTime <= line.end
  );

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "60px",
        backgroundColor: "transparent",
        fontFamily: "'Outfit', 'Inter', Arial, sans-serif",
      }}
    >
      {/* Lyrics List Container */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: "24px" }}>
        {lines.map((line: any, idx: number) => {
          const isActive = idx === activeIndex;
          const isPast = currentTime > line.end;
          
          return (
            <div
              key={idx}
              style={{
                fontSize: `${fontSize}px`,
                fontWeight: 800,
                lineHeight: 1.3,
                letterSpacing: "-0.02em",
                color: isActive ? activeTextColor : textColor,
                opacity: isActive ? 1.0 : isPast ? 0.6 : 0.3,
                transition: "all 0.2s ease-in-out",
                transform: isActive ? "scale(1.02)" : "scale(1.0)",
                transformOrigin: "left center",
              }}
            >
              {line.text}
            </div>
          );
        })}
      </div>

      {/* Spotify Branding / Player Footer */}
      <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginTop: "auto" }}>
        {showProgressBar && (
          <div style={{ width: "100%", height: "4px", backgroundColor: "#333", borderRadius: "2px", overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${(currentTime / totalDuration) * 100}%`,
                backgroundColor: activeTextColor,
              }}
            />
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          {albumArtUrl ? (
            <img
              src={albumArtUrl}
              style={{ width: "48px", height: "48px", borderRadius: "8px", border: "1px solid #333", objectFit: "cover" }}
              alt="Album Art"
            />
          ) : (
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "8px",
                backgroundColor: "#222",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: activeTextColor,
                fontWeight: "bold",
                fontSize: "18px",
                border: "1px solid #333",
              }}
            >
              ♫
            </div>
          )}
          
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <span style={{ fontSize: "14px", fontWeight: "bold", color: "#fff" }}>Lvon preset</span>
            <span style={{ fontSize: "11px", color: "#666" }}>Spotify Lyrical Style</span>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
