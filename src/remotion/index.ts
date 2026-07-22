import { registerRoot, Composition } from "remotion";
import { BratComposition } from "./compositions/Brat";
import { SpotifyLyricsComposition } from "./compositions/SpotifyLyrics";
import { QuoteComposition } from "./compositions/Quote";
import { EditorialCaption } from "./compositions/EditorialCaption";
import React from "react";

// Register all bundled self-hosted fonts (public/fonts/<slug>/, see src/lib/fonts.ts).
// Covers: Inter, IBM Plex Sans, Archivo, Barlow, Barlow Condensed, Oswald,
// Anton, Public Sans, Libre Franklin, Source Sans 3 — all weights on disk.
import { registerBundledFonts } from "./fonts";

// Non-bundled families still load via @remotion/google-fonts (CDN).
import { loadFont as loadRoboto } from "@remotion/google-fonts/Roboto";
import { loadFont as loadRobotoCondensed } from "@remotion/google-fonts/RobotoCondensed";
import { loadFont as loadLora } from "@remotion/google-fonts/Lora";

try {
  registerBundledFonts();
  loadRoboto();
  loadRobotoCondensed();
  loadLora();
} catch (e) {
  console.warn("Failed to register Remotion fonts:", e);
}

const RemotionRoot: React.FC = () => {
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(Composition, {
      id: "brat",
      component: BratComposition,
      durationInFrames: 300, // 10 seconds
      fps: 30,
      width: 720,
      height: 1280,
      defaultProps: {
        text: "brat",
        textColor: "#000000",
        bgColor: "#8ace00",
        fontSize: 90,
        blur: 2,
        isItalic: true,
        isBold: true,
      },
    }),
    React.createElement(Composition, {
      id: "spotify-lyrics",
      component: SpotifyLyricsComposition,
      durationInFrames: 450, // 15 seconds
      fps: 30,
      width: 720,
      height: 1280,
      defaultProps: {
        textColor: "#ffffff",
        activeTextColor: "#1db954",
        fontSize: 32,
        albumArtUrl: "",
        showProgressBar: true,
      },
    }),
    React.createElement(Composition, {
      id: "quote",
      component: QuoteComposition,
      durationInFrames: 300, // 10 seconds
      fps: 30,
      width: 720,
      height: 1280,
      defaultProps: {
        quoteText: "Be yourself; everyone else is already taken.",
        author: "Oscar Wilde",
        textColor: "#ffffff",
        bgColor: "transparent",
        fontSize: 28,
        animationSpeed: 1,
      },
    }),
    React.createElement(Composition, {
      id: "editorial-caption",
      component: EditorialCaption,
      durationInFrames: 30,
      fps: 30,
      width: 720,
      height: 1280,
      defaultProps: {
        styleKey: "news-lower-third",
        text: "STREET PROTESTS INTENSIFY AROUND CITIZEN CONCERNS",
        fontSize: 32,
        fontColor: "#FFFFFF",
        bgStripColor: "#000000",
        bgStripOpacity: 0.85,
        positionYPercent: 75,
        marginX: 40,
        paddingY: 20,
        paddingX: 20,
        accentColor: "#E11D48",
        author: "",
      },
    })
  );
};

registerRoot(RemotionRoot);
