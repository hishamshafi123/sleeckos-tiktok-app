import React from "react";
import { AbsoluteFill } from "remotion";

export interface BratProps {
  text?: string;
  textColor?: string;
  bgColor?: string;
  fontSize?: number;
  blur?: number;
  isItalic?: boolean;
  isBold?: boolean;
}

export const BratComposition: React.FC<BratProps> = ({
  text = "brat",
  textColor = "#000000",
  bgColor = "#8ace00",
  fontSize = 90,
  blur = 2,
  isItalic = true,
  isBold = true,
}) => {
  const isTransparent = bgColor === "transparent" || bgColor === "none";
  
  return (
    <AbsoluteFill
      style={{
        backgroundColor: isTransparent ? "transparent" : bgColor,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          color: textColor,
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: `${fontSize}px`,
          fontWeight: isBold ? "bold" : "normal",
          fontStyle: isItalic ? "italic" : "normal",
          textAlign: "center",
          filter: blur > 0 ? `blur(${blur}px)` : "none",
          letterSpacing: "-0.04em",
          transform: "scaleY(1.05)", // slightly stretched vertically
          wordBreak: "break-word",
          padding: "0 40px",
        }}
      >
        {text.toLowerCase()}
      </div>
    </AbsoluteFill>
  );
};
