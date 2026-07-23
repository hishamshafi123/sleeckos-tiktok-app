import type React from "react";
import type { StyleParams } from "../../../../lib/style-lab/schema";
import { KineticChars } from "./KineticChars";
import { BounceTitle } from "./BounceTitle";
import { BubblePop } from "./BubblePop";
import { ChapterTitle } from "./ChapterTitle";
import { CinematicTitle } from "./CinematicTitle";
import { CreditsRoll } from "./CreditsRoll";
import { FloatingBubble } from "./FloatingBubble";
import { GlitchText } from "./GlitchText";
import { LowerThird } from "./LowerThird";
import { PoppingText } from "./PoppingText";
import { PulsingText } from "./PulsingText";
import { QuoteFade } from "./QuoteFade";
import { SlideText } from "./SlideText";
import { TextHighlight } from "./TextHighlight";
import { TitleSplit } from "./TitleSplit";
import { Typewriter } from "./Typewriter";
import { SpotlightReveal } from "./SpotlightReveal";
import { AnimatedList } from "./AnimatedList";

/**
 * Template key → component map for the imported collection
 * (see src/lib/style-lab/imported.ts for the matching schemas/durations).
 * Keys must stay in sync with IMPORTED_STYLE_TEMPLATES.
 */
export const IMPORTED_COMPONENTS: Record<string, React.FC<StyleParams>> = {
  "imp-kinetic-chars": KineticChars,
  "imp-bounce-title": BounceTitle,
  "imp-bubble-pop": BubblePop,
  "imp-chapter-title": ChapterTitle,
  "imp-cinematic-title": CinematicTitle,
  "imp-credits-roll": CreditsRoll,
  "imp-floating-bubble": FloatingBubble,
  "imp-glitch-text": GlitchText,
  "imp-lower-third": LowerThird,
  "imp-popping-text": PoppingText,
  "imp-pulsing-text": PulsingText,
  "imp-quote-fade": QuoteFade,
  "imp-slide-text": SlideText,
  "imp-text-highlight": TextHighlight,
  "imp-title-split": TitleSplit,
  "imp-typewriter": Typewriter,
  "imp-spotlight-reveal": SpotlightReveal,
  "imp-animated-list": AnimatedList,
};
