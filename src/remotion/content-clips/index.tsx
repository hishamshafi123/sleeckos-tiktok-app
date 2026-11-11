import React from "react";
import { Composition, registerRoot } from "remotion";
import { NewsClip } from "./NewsClip";
import { defaultDraft, FPS, framesFor } from "../../lib/content-clips/schema";
const draft = defaultDraft("State news");
registerRoot(() => (
  <Composition
    id="news-clip"
    component={NewsClip}
    width={720}
    height={1280}
    fps={FPS}
    durationInFrames={framesFor(draft)}
    defaultProps={{ src: "", draft, words: [] }}
    calculateMetadata={({ props }) => ({
      durationInFrames: framesFor(props.draft),
    })}
  />
));
