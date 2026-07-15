import { registerRoot, Composition } from "remotion";
import { BratComposition } from "./compositions/Brat";
import { SpotifyLyricsComposition } from "./compositions/SpotifyLyrics";
import { QuoteComposition } from "./compositions/Quote";
import { EditorialCaption } from "./compositions/EditorialCaption";
import React from "react";

// Load/register curated editorial fonts for Remotion rendering
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadIbmPlexSans } from "@remotion/google-fonts/IBMPlexSans";
import { loadFont as loadSourceSans3 } from "@remotion/google-fonts/SourceSans3";
import { loadFont as loadLibreFranklin } from "@remotion/google-fonts/LibreFranklin";
import { loadFont as loadArchivo } from "@remotion/google-fonts/Archivo";
import { loadFont as loadBarlow } from "@remotion/google-fonts/Barlow";
import { loadFont as loadBarlowCondensed } from "@remotion/google-fonts/BarlowCondensed";
import { loadFont as loadRoboto } from "@remotion/google-fonts/Roboto";
import { loadFont as loadRobotoCondensed } from "@remotion/google-fonts/RobotoCondensed";
import { loadFont as loadOswald } from "@remotion/google-fonts/Oswald";
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { loadFont as loadPublicSans } from "@remotion/google-fonts/PublicSans";
import { loadFont as loadLora } from "@remotion/google-fonts/Lora";

try {
  loadInter();
  loadIbmPlexSans();
  loadSourceSans3();
  loadLibreFranklin();
  loadArchivo();
  loadBarlow();
  loadBarlowCondensed();
  loadRoboto();
  loadRobotoCondensed();
  loadOswald();
  loadAnton();
  loadPublicSans();
  loadLora();
} catch (e) {
  console.warn("Failed to register Remotion Google Fonts:", e);
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
