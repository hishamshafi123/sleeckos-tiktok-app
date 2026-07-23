import type React from "react";
import { LyricCaption } from "./LyricCaption";
import { QuoteCard } from "./QuoteCard";
import { LayeredStyle } from "./LayeredStyle";
import { BratLyrics } from "./BratLyrics";
import { IMPORTED_COMPONENTS } from "./imported";
import { BRAT_TEMPLATE_KEY, isAiTemplateKey, type StyleFamily, type StyleParams } from "../../../lib/style-lab/schema";

/**
 * Client-side template key → component resolution, shared by the Style Lab
 * live preview (Remotion Player). brat-lyrics has its own composition
 * (accumulating words + auto-fit justified type); imported templates resolve
 * through IMPORTED_COMPONENTS. AI-generated templates (ai_* keys) are layered
 * styles by construction and resolve through the layered-style comp — their
 * layer stack arrives via input props.
 */
export function styleComponentFor(templateKey: string, family: StyleFamily): React.FC<any> {
  if (isAiTemplateKey(templateKey)) return LayeredStyle as React.FC<any>;
  if (templateKey === BRAT_TEMPLATE_KEY) return BratLyrics as React.FC<any>;
  const imported = IMPORTED_COMPONENTS[templateKey];
  if (imported) return imported as React.FC<any>;
  return (family === "quote" ? QuoteCard : LyricCaption) as React.FC<StyleParams> as React.FC<any>;
}

/** Composition that renders any layer stack — used when a style has layers. */
export const LayeredStyleComponent = LayeredStyle as React.FC<any>;
