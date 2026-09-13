import { describe, expect, it } from "vitest";

import { REPLAY_CHART_COLORS_DARK, REPLAY_CHART_COLORS_LIGHT, getReplayChartColors } from "@/components/replay/replay-chart-colors";
import { isLightweightChartSafeColor } from "@/components/replay/chart-color-safety";

describe("getReplayChartColors — theme selection", () => {
  it("returns the dark palette for 'dark', undefined, and any other value (matches defaultTheme=\"dark\")", () => {
    expect(getReplayChartColors("dark")).toBe(REPLAY_CHART_COLORS_DARK);
    expect(getReplayChartColors(undefined)).toBe(REPLAY_CHART_COLORS_DARK);
    expect(getReplayChartColors("system")).toBe(REPLAY_CHART_COLORS_DARK);
  });

  it("returns the light palette only for exactly 'light'", () => {
    expect(getReplayChartColors("light")).toBe(REPLAY_CHART_COLORS_LIGHT);
  });
});

describe("Replay chart palettes — every value is lightweight-charts-safe", () => {
  it("every dark palette color passes isLightweightChartSafeColor", () => {
    for (const [key, value] of Object.entries(REPLAY_CHART_COLORS_DARK)) {
      expect(isLightweightChartSafeColor(value), `${key}: ${value}`).toBe(true);
    }
  });

  it("every light palette color passes isLightweightChartSafeColor", () => {
    for (const [key, value] of Object.entries(REPLAY_CHART_COLORS_LIGHT)) {
      expect(isLightweightChartSafeColor(value), `${key}: ${value}`).toBe(true);
    }
  });

  it("neither palette contains any CSS Color 4 function or an unresolved CSS variable", () => {
    const unsafePattern = /oklch\(|lab\(|lch\(|color\(|color-mix\(|var\(--/;
    for (const value of [...Object.values(REPLAY_CHART_COLORS_DARK), ...Object.values(REPLAY_CHART_COLORS_LIGHT)]) {
      expect(value).not.toMatch(unsafePattern);
    }
  });
});

describe("no unresolved CSS variable or CSS Color 4 expression reaches the Replay chart", () => {
  // §9/§10 — audits the chart itself PLUS every source of price-line/marker
  // colors handed to it (entry/stop/targets/drawing lines, fill/close markers).
  const FILES_TO_AUDIT = ["src/components/replay/replay-candlestick-chart.tsx", "src/components/replay/replay-market-panel.tsx"];

  it.each(FILES_TO_AUDIT)("%s never passes an unsafe color literal (oklch/lab/lch/color/color-mix/var) as a color value", async (relativePath) => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const filePath = path.join(process.cwd(), relativePath);
    const source = await fs.readFile(filePath, "utf-8");

    // Strip comments/doc-blocks first — this test guards actual CODE, not
    // prose that happens to mention the pattern while explaining the fix.
    const codeOnly = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");

    for (const pattern of [/oklch\(/, /lab\(/, /lch\(/, /\bcolor\(/, /color-mix\(/, /var\(--/]) {
      expect(codeOnly).not.toMatch(pattern);
    }
  });
});
