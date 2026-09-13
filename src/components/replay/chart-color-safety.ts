/**
 * Strict runtime guard against the exact class of bug that hit both
 * Chrome (`Failed to parse color: var(--muted-foreground)`) and Safari
 * (`Failed to parse color: lab(65.75 -0.14 -2.27)`): a color reaching
 * `lightweight-charts` that isn't in a format its own parser accepts.
 *
 * We do NOT ask a browser to tell us whether a color is safe (that's
 * exactly the assumption that broke in Safari) — this is a pure,
 * deterministic string check against the small set of formats
 * lightweight-charts actually supports.
 */

import type { ReplayChartColors } from "@/components/replay/replay-chart-colors";

const HEX_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGB_PATTERN = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/;

/**
 * Accepts only: `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(...)`, `rgba(...)`,
 * and the literal keyword `"transparent"`. Rejects everything else,
 * including every CSS Color 4 function (`oklch`, `lab`, `lch`, `color`,
 * `color-mix`) and any unresolved `var(--x)` reference.
 */
export function isLightweightChartSafeColor(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "transparent") return true;
  if (HEX_PATTERN.test(trimmed)) return true;
  if (RGB_PATTERN.test(trimmed)) return true;
  return false;
}

/**
 * Dev-only assertion — called right before `createChart`/`applyOptions`
 * so a future unsafe color is caught as a clear, immediate internal error
 * pointing at exactly which key is unsafe, instead of a mysterious
 * "Failed to parse color" thrown deep inside the chart library (and,
 * per the Safari case, possibly only in ONE browser). A no-op in
 * production — this is a development-time contract check, not a runtime
 * fallback/sanitizer (an unsafe color should never ship, not be silently
 * patched over).
 */
export function assertLightweightChartSafeColors(colors: ReplayChartColors): void {
  if (process.env.NODE_ENV === "production") return;
  for (const [key, value] of Object.entries(colors)) {
    if (!isLightweightChartSafeColor(value)) {
      throw new Error(`Replay chart color "${key}" is not lightweight-charts-safe: "${value}". Use a literal hex/rgb(a) value or "transparent" — never a CSS Color 4 function or an unresolved var().`);
    }
  }
}
