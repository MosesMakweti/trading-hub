import { afterEach, describe, expect, it, vi } from "vitest";

import { assertLightweightChartSafeColors, isLightweightChartSafeColor } from "@/components/replay/chart-color-safety";
import type { ReplayChartColors } from "@/components/replay/replay-chart-colors";

describe("isLightweightChartSafeColor — rejects every CSS Color 4 / unresolved-variable form", () => {
  it.each([
    ["oklch(0.42 0.012 255)", false],
    ["lab(65.753998 -0.138819 -2.26735)", false], // the exact Safari-reported value
    ["lch(52% 40 25)", false],
    ["color(display-p3 1 0 0)", false],
    ["color-mix(in oklch, var(--border) 60%, transparent)", false],
    ["var(--foo)", false],
    ["var(--muted-foreground)", false], // the exact Chrome-reported value
  ])("%s -> %s", (value, expected) => {
    expect(isLightweightChartSafeColor(value)).toBe(expected);
  });
});

describe("isLightweightChartSafeColor — accepts every format lightweight-charts actually supports", () => {
  it.each([
    ["#fff", true],
    ["#ffffff", true],
    ["#ffffff80", true],
    ["rgb(255, 255, 255)", true],
    ["rgba(255, 255, 255, 0.5)", true],
    ["rgba(0, 0, 0, 1)", true],
    ["transparent", true],
  ])("%s -> %s", (value, expected) => {
    expect(isLightweightChartSafeColor(value)).toBe(expected);
  });
});

describe("assertLightweightChartSafeColors — dev-mode contract check", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function withNodeEnv<T>(env: string, fn: () => T): T {
    vi.stubEnv("NODE_ENV", env);
    return fn();
  }

  it("does not throw for an all-safe palette", () => {
    withNodeEnv("development", () => {
      const colors: ReplayChartColors = {
        textColor: "#9ca3af",
        gridColor: "rgba(255, 255, 255, 0.08)",
        borderColor: "rgba(255, 255, 255, 0.12)",
        upColor: "#22c55e",
        downColor: "#ef4444",
        selectedShapeColor: "#3b82f6",
        unselectedShapeColor: "rgba(209, 213, 219, 0.55)",
        rectangleFillColor: "rgba(59, 130, 246, 0.12)",
      };
      expect(() => assertLightweightChartSafeColors(colors)).not.toThrow();
    });
  });

  it("throws a clear internal error naming the offending key when a palette value is unsafe, in development", () => {
    withNodeEnv("development", () => {
      const colors = {
        textColor: "oklch(0.42 0.012 255)",
        gridColor: "rgba(255, 255, 255, 0.08)",
        borderColor: "rgba(255, 255, 255, 0.12)",
        upColor: "#22c55e",
        downColor: "#ef4444",
        selectedShapeColor: "#3b82f6",
        unselectedShapeColor: "rgba(209, 213, 219, 0.55)",
        rectangleFillColor: "rgba(59, 130, 246, 0.12)",
      } as ReplayChartColors;
      expect(() => assertLightweightChartSafeColors(colors)).toThrow(/textColor/);
    });
  });

  it("is a no-op in production — never throws even for an unsafe value", () => {
    withNodeEnv("production", () => {
      const colors = { textColor: "lab(65.75 -0.14 -2.27)" } as unknown as ReplayChartColors;
      expect(() => assertLightweightChartSafeColors(colors)).not.toThrow();
    });
  });
});
