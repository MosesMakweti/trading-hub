/**
 * Semantic annotation colors (spec §7) — CSS custom-property references so
 * they follow the app's existing light/dark theme tokens rather than fixed
 * hex values that would look wrong in one theme.
 */
import type { AnnotationType } from "@prisma/client";

export const ANNOTATION_COLOR_BY_TYPE: Record<AnnotationType, string> = {
  ENTRY: "var(--color-primary)",
  STOP_LOSS: "var(--color-danger)",
  TARGET: "var(--color-success)",
  INVALIDATION: "var(--color-warning)",
  BREAK_EVEN: "var(--color-muted-foreground)",
  CUSTOM: "var(--color-primary)",
};

export const ANNOTATION_LABEL_BY_TYPE: Record<AnnotationType, string> = {
  ENTRY: "Entry",
  STOP_LOSS: "Stop-loss",
  TARGET: "Target",
  INVALIDATION: "Invalidation",
  BREAK_EVEN: "Break-even",
  CUSTOM: "Custom level",
};

export function defaultAnnotationColor(type: AnnotationType): string {
  return ANNOTATION_COLOR_BY_TYPE[type];
}
