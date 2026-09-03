/**
 * Shared recharts theme constants — every chart in this module was hand-building
 * the same tooltip `contentStyle` and axis `tick` objects (values always
 * identical, never customized per-chart). One source of truth here instead.
 */
export const CHART_TOOLTIP_STYLE = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--popover-foreground)",
} as const;

export const CHART_AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 11 } as const;
