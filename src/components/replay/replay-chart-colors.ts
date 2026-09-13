/**
 * Explicit, static, lightweight-charts-safe color palette for the Replay
 * chart (dark + light) — replaces an earlier attempt at DYNAMICALLY
 * resolving Traditorium's oklch theme tokens through a canvas `fillStyle`
 * round-trip at runtime.
 *
 * That approach was proven unreliable: it assumed a canvas 2D context's
 * `fillStyle` getter always normalizes back to `#rrggbb`/`rgba(...)`
 * regardless of input color space. In Chrome/Node that held; in Safari,
 * assigning an oklch-derived color to `fillStyle` and reading it back can
 * yield a literal `lab(...)` string instead — which `lightweight-charts`'
 * own parser rejects exactly like it rejects `oklch(...)`/`var(...)`. So
 * canvas serialization is NOT a reliable normalization boundary; browser
 * behavior here is implementation-defined, not standardized in the way
 * the earlier fix assumed. See `chart-color-safety.ts` for the strict
 * validator that now guards against this class of bug recurring.
 *
 * The fix: never derive a lightweight-charts color from ANY runtime CSS
 * resolution step. Both palettes below are 100% literal `#hex`/`rgba(...)`
 * values, hand-picked to sit close to Traditorium's actual theme tokens
 * (see `globals.css`) and to match the hex values Replay already uses
 * elsewhere for price lines/markers (`replay-market-panel.tsx`) — chart
 * compatibility takes priority over perfectly mirroring the live theme.
 */

export interface ReplayChartColors {
  textColor: string;
  gridColor: string;
  borderColor: string;
  upColor: string;
  downColor: string;
  selectedShapeColor: string;
  unselectedShapeColor: string;
  rectangleFillColor: string;
}

/** Traditorium's dark theme (the app default) — approximates
 *  `--muted-foreground`/`--border`/`--success`/`--danger`/`--primary`/
 *  `--foreground` from `globals.css`'s `.dark` block, in plain hex/rgba. */
export const REPLAY_CHART_COLORS_DARK: ReplayChartColors = {
  textColor: "#9ca3af",
  gridColor: "rgba(255, 255, 255, 0.08)",
  borderColor: "rgba(255, 255, 255, 0.12)",
  upColor: "#22c55e",
  downColor: "#ef4444",
  selectedShapeColor: "#3b82f6",
  unselectedShapeColor: "rgba(209, 213, 219, 0.55)",
  rectangleFillColor: "rgba(59, 130, 246, 0.12)",
};

/** Traditorium's light theme — approximates the same tokens from
 *  `globals.css`'s `:root` block. */
export const REPLAY_CHART_COLORS_LIGHT: ReplayChartColors = {
  textColor: "#6b7280",
  gridColor: "rgba(17, 24, 39, 0.08)",
  borderColor: "rgba(17, 24, 39, 0.12)",
  upColor: "#16a34a",
  downColor: "#dc2626",
  selectedShapeColor: "#2563eb",
  unselectedShapeColor: "rgba(75, 85, 99, 0.55)",
  rectangleFillColor: "rgba(37, 99, 235, 0.1)",
};

/** `resolvedTheme` is `next-themes`' own value ("dark" | "light" |
 *  undefined pre-hydration) — anything other than exactly `"light"`
 *  defaults to dark, matching the app's `defaultTheme="dark"`. */
export function getReplayChartColors(resolvedTheme: string | undefined): ReplayChartColors {
  return resolvedTheme === "light" ? REPLAY_CHART_COLORS_LIGHT : REPLAY_CHART_COLORS_DARK;
}
