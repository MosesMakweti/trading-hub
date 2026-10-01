// Data-visualization tokens — the single source of truth for chart colour
// roles and chrome. Every value resolves to a CSS custom property defined in
// globals.css (light + dark), so charts follow the theme with no JS.
//
// Colour is assigned by the JOB it does (docs/ANALYTICS_VISUALIZATION.md §2):
//   polarity  → profit / loss / neutral      (money, R, returns)
//   status    → warning                       (near a limit; always icon + label)
//   identity  → series slots 1–6              (strategies, sessions, datasets)
//   reference → dashed muted ink              (expected, targets, limits, averages)
// Data hues are for marks only — text always wears text tokens.
//
// Plain module (no "use client"): safe to import from Server Components.

export const VIZ = {
  profit: "var(--viz-profit)",
  loss: "var(--viz-loss)",
  neutral: "var(--viz-neutral)",
  warning: "var(--viz-warning)",
  reference: "var(--viz-reference)",
  grid: "var(--viz-grid)",
  axis: "var(--viz-axis)",
  crosshair: "var(--viz-crosshair)",
  surface: "var(--card)",
  ink: "var(--foreground)",
  mutedInk: "var(--muted-foreground)",
} as const;

/** Categorical identity slots, in their validated (CVD-safe) order. */
export const SERIES = [
  "var(--viz-1)",
  "var(--viz-2)",
  "var(--viz-3)",
  "var(--viz-4)",
  "var(--viz-5)",
  "var(--viz-6)",
] as const;

export const SERIES_SLOTS = SERIES.length;

/** Slot colour by position. Past the last slot an identity folds into the
 *  neutral "Other" colour — never a generated 7th hue. */
export function seriesColor(index: number): string {
  return index >= 0 && index < SERIES_SLOTS ? SERIES[index] : VIZ.neutral;
}

/**
 * Stable entity → colour map. Pass the FULL universe of keys (e.g. every
 * strategy the user has, not just the ones in the current filter) in a stable
 * order; colour then follows the entity, never its rank, so filtering never
 * repaints the survivors. Keys past the sixth fold into neutral.
 */
export function identityColorMap(keys: readonly string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const key of keys) {
    if (!map.has(key)) map.set(key, seriesColor(map.size));
  }
  return map;
}

/** Polarity colour for a signed value (profit / loss / flat). */
export function polarityColor(n: number | null | undefined, epsilon = 1e-9): string {
  if (n == null || Math.abs(n) <= epsilon) return VIZ.neutral;
  return n > 0 ? VIZ.profit : VIZ.loss;
}

export type Polarity = "profit" | "loss" | "neutral";

export function polarityOf(n: number | null | undefined, epsilon = 1e-9): Polarity {
  if (n == null || Math.abs(n) <= epsilon) return "neutral";
  return n > 0 ? "profit" : "loss";
}

/** A wash of a colour over the card surface — for fills, cells and tracks.
 *  `percent` is the share of `color` (0–100). */
export function tint(color: string, percent: number): string {
  const p = Math.max(0, Math.min(100, percent));
  return `color-mix(in oklch, ${color} ${p}%, var(--card))`;
}

/** Recharts chrome, shared so every chart reads as one instrument family:
 *  solid hairline grid, recessive axes, tabular tick figures. */
export const CHART = {
  tick: { fill: "var(--muted-foreground)", fontSize: 11, fontVariantNumeric: "tabular-nums" },
  grid: { stroke: VIZ.grid, strokeDasharray: undefined, vertical: false },
  xAxis: {
    tickLine: false,
    axisLine: { stroke: VIZ.axis },
    minTickGap: 32,
    tickMargin: 8,
  },
  yAxis: { tickLine: false, axisLine: false, tickMargin: 6 },
  /** Recharts' own entrance animation — short, mount-only. */
  animationMs: 450,
  lineWidth: 2,
  referenceDash: "4 4",
  cursor: { stroke: VIZ.crosshair, strokeWidth: 1 },
  margin: { top: 8, right: 12, bottom: 0, left: 0 },
} as const;

/**
 * Calendar-day wash for a signed day result: profit/loss tint whose strength
 * grows with |value| up to `fullAt` (e.g. 3 for ±3R / ±3%), capped at `max`
 * percent so the day's text stays readable on it. Null for no result / flat.
 */
export function dayTint(value: number | null | undefined, fullAt = 3, { min = 8, max = 30 } = {}): string | undefined {
  if (value == null || Math.abs(value) < 1e-9) return undefined;
  const t = Math.min(1, Math.abs(value) / fullAt);
  return tint(value > 0 ? VIZ.profit : VIZ.loss, min + t * (max - min));
}
