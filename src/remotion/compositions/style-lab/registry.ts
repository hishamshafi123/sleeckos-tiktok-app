import type React from "react";
import { LyricCaption } from "./LyricCaption";
import { QuoteCard } from "./QuoteCard";
import { IMPORTED_COMPONENTS } from "./imported";
import type { StyleFamily, StyleParams } from "../../../lib/style-lab/schema";

/**
 * Client-side template key → component resolution, shared by the Style Lab
 * live preview (Remotion Player). brat-lyrics reuses the LyricCaption comp
 * (brat is a param-default variant, not a new composition); imported
 * templates resolve through IMPORTED_COMPONENTS.
 */
export function styleComponentFor(templateKey: string, family: StyleFamily): React.FC<any> {
  const imported = IMPORTED_COMPONENTS[templateKey];
  if (imported) return imported as React.FC<any>;
  return (family === "quote" ? QuoteCard : LyricCaption) as React.FC<StyleParams> as React.FC<any>;
}
