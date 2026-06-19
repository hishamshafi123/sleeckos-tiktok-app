import React from "react";
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";

export interface QuoteProps {
  quoteText?: string;
  author?: string;
  textColor?: string;
  bgColor?: string;
  fontSize?: number;
  animationSpeed?: number;
}

export const QuoteComposition: React.FC<QuoteProps> = ({
  quoteText = "Be yourself; everyone else is already taken.",
  author = "Oscar Wilde",
  textColor = "#ffffff",
  bgColor = "transparent",
  fontSize = 28,
  animationSpeed = 1,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Animation spring states using standard damping config
  const quoteSpring = spring({
    frame: frame * animationSpeed,
    fps,
    config: { damping: 12 },
  });

  const authorSpring = spring({
    frame: Math.max(0, frame - 15) * animationSpeed,
    fps,
    config: { damping: 12 },
  });

  const isTransparent = bgColor === "transparent" || bgColor === "none";

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: isTransparent ? "transparent" : bgColor,
        padding: "48px",
        fontFamily: "'Playfair Display', Georgia, serif",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          maxWidth: "600px",
          gap: "24px",
          transform: `translateY(${(1 - quoteSpring) * 30}px)`,
          opacity: quoteSpring,
        }}
      >
        {/* Large quotation mark styling */}
        <span
          style={{
            fontSize: "64px",
            color: textColor,
            opacity: 0.3,
            lineHeight: 1,
            marginBottom: "-20px",
          }}
        >
          “
        </span>

        {/* Quote text overlay */}
        <div
          style={{
            fontSize: `${fontSize}px`,
            color: textColor,
            fontWeight: "normal",
            fontStyle: "italic",
            lineHeight: 1.5,
            letterSpacing: "0.02em",
          }}
        >
          {quoteText}
        </div>

        {/* Divider bar */}
        <div
          style={{
            width: "40px",
            height: "1px",
            backgroundColor: textColor,
            opacity: 0.2,
            margin: "8px 0",
          }}
        />

        {/* Author display */}
        <div
          style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: `${Math.round(fontSize * 0.6)}px`,
            color: textColor,
            opacity: authorSpring * 0.8,
            fontWeight: "bold",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            transform: `translateY(${(1 - authorSpring) * 15}px)`,
          }}
        >
          — {author}
        </div>
      </div>
    </AbsoluteFill>
  );
};
