import React from "react";
import { AbsoluteFill } from "remotion";

export interface EditorialCaptionProps {
  styleKey?: "news-lower-third" | "breaking-headline" | "subtitle-box" | "quote-card";
  text?: string;
  fontSize?: number;
  fontColor?: string;
  bgStripColor?: string;
  bgStripOpacity?: number;
  positionYPercent?: number;
  marginX?: number;
  paddingY?: number;
  paddingX?: number;
  accentColor?: string;
  author?: string;
}

export const EditorialCaption: React.FC<EditorialCaptionProps> = ({
  styleKey = "news-lower-third",
  text = "",
  fontSize = 32,
  fontColor = "#FFFFFF",
  bgStripColor = "#000000",
  bgStripOpacity = 0.85,
  positionYPercent = 75,
  marginX = 40,
  paddingY = 20,
  paddingX = 20,
  accentColor = "#E11D48", // Editorial Red
  author = "",
}) => {
  // Common styling calculations
  const leftX = marginX;
  const widthVal = 720 - marginX * 2;
  const opacityVal = Math.max(0, Math.min(1, bgStripOpacity));

  // Render different presets
  const renderCard = () => {
    switch (styleKey) {
      case "breaking-headline": {
        const headlineText = text.trim().toUpperCase();
        return (
          <div
            style={{
              position: "absolute",
              top: `${positionYPercent}%`,
              left: `${leftX}px`,
              width: `${widthVal}px`,
              transform: "translateY(-50%)",
              backgroundColor: bgStripColor,
              opacity: opacityVal,
              borderLeft: `6px solid ${accentColor}`,
              boxShadow: "0 4px 15px rgba(0, 0, 0, 0.4)",
              padding: `${paddingY}px ${paddingX}px`,
              display: "flex",
              flexDirection: "column",
              gap: "4px",
            }}
          >
            <div
              style={{
                color: accentColor,
                fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
                fontSize: `${Math.round(fontSize * 0.55)}px`,
                fontWeight: "900",
                letterSpacing: "0.15em",
                textTransform: "uppercase",
              }}
            >
              ★ BREAKING NEWS
            </div>
            <div
              style={{
                color: fontColor,
                fontFamily: "'Oswald', 'Impact', sans-serif",
                fontSize: `${fontSize}px`,
                fontWeight: "bold",
                lineHeight: "1.2",
                letterSpacing: "-0.01em",
                wordBreak: "break-word",
              }}
            >
              {headlineText}
            </div>
          </div>
        );
      }

      case "subtitle-box": {
        return (
          <div
            style={{
              position: "absolute",
              top: `${positionYPercent}%`,
              left: `${leftX}px`,
              width: `${widthVal}px`,
              transform: "translateY(-50%)",
              backgroundColor: bgStripColor,
              opacity: opacityVal,
              borderRadius: "8px",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              padding: `${paddingY}px ${paddingX}px`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 8px 24px rgba(0, 0, 0, 0.25)",
            }}
          >
            <div
              style={{
                color: fontColor,
                fontFamily: "'Inter', sans-serif",
                fontSize: `${fontSize}px`,
                fontWeight: "600",
                lineHeight: "1.4",
                textAlign: "center",
                wordBreak: "break-word",
              }}
            >
              {text}
            </div>
          </div>
        );
      }

      case "quote-card": {
        return (
          <div
            style={{
              position: "absolute",
              top: `${positionYPercent}%`,
              left: `${leftX}px`,
              width: `${widthVal}px`,
              transform: "translateY(-50%)",
              backgroundColor: bgStripColor,
              opacity: opacityVal,
              borderRadius: "12px",
              boxShadow: "0 10px 30px rgba(0, 0, 0, 0.35)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              padding: `${paddingY * 1.5}px ${paddingX * 1.5}px`,
              display: "flex",
              flexDirection: "column",
              gap: "14px",
            }}
          >
            {/* Big quote symbol */}
            <span
              style={{
                position: "absolute",
                top: "-15px",
                left: "20px",
                fontSize: "72px",
                lineHeight: "1",
                fontFamily: "Georgia, serif",
                color: accentColor,
                opacity: 0.8,
              }}
            >
              “
            </span>
            <div
              style={{
                color: fontColor,
                fontFamily: "'Georgia', 'Lora', serif",
                fontSize: `${fontSize}px`,
                fontStyle: "italic",
                lineHeight: "1.4",
                wordBreak: "break-word",
                marginTop: "10px",
              }}
            >
              {text}
            </div>
            {author && (
              <div
                style={{
                  color: "#A1A1AA",
                  fontFamily: "'Inter', sans-serif",
                  fontSize: `${Math.round(fontSize * 0.65)}px`,
                  fontWeight: "bold",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  borderTop: "1px solid rgba(255, 255, 255, 0.1)",
                  paddingTop: "10px",
                  alignSelf: "flex-start",
                }}
              >
                — {author}
              </div>
            )}
          </div>
        );
      }

      case "news-lower-third":
      default: {
        return (
          <div
            style={{
              position: "absolute",
              top: `${positionYPercent}%`,
              left: `${leftX}px`,
              width: `${widthVal}px`,
              transform: "translateY(-50%)",
              backgroundColor: bgStripColor,
              opacity: opacityVal,
              borderLeft: `5px solid ${accentColor}`,
              padding: `${paddingY}px ${paddingX}px`,
              boxShadow: "0 6px 20px rgba(0, 0, 0, 0.3)",
              display: "flex",
              flexDirection: "column",
              gap: "2px",
            }}
          >
            <div
              style={{
                color: fontColor,
                fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
                fontSize: `${fontSize}px`,
                fontWeight: "800",
                lineHeight: "1.3",
                wordBreak: "break-word",
              }}
            >
              {text}
            </div>
          </div>
        );
      }
    }
  };

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "transparent",
        width: "720px",
        height: "1280px",
        position: "relative",
      }}
    >
      {renderCard()}
    </AbsoluteFill>
  );
};
