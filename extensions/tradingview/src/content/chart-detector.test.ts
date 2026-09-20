import { describe, expect, it } from "vitest";

import { detectChartContext, type DetectionEnv } from "./chart-detector";

function env(overrides: { search?: string; title?: string; dom?: Record<string, string> }): DetectionEnv {
  const dom = overrides.dom ?? {};
  return {
    location: { search: overrides.search ?? "" },
    document: {
      title: overrides.title ?? "",
      querySelector: (selector: string) => {
        const text = dom[selector];
        return text == null ? null : ({ textContent: text } as unknown as Element);
      },
    },
  };
}

const FIXED_NOW = () => 1_700_000_000_000;

describe("detectChartContext", () => {
  it("prefers the URL symbol over title/DOM, and reports its source as 'url'", () => {
    const ctx = detectChartContext(
      env({ search: "?symbol=OANDA:XAUUSD", title: "EURUSD, 5 — TradingView" }),
      FIXED_NOW,
    );
    expect(ctx.symbol).toEqual({ raw: "OANDA:XAUUSD", display: "XAUUSD", exchange: "OANDA" });
    expect(ctx.symbolSource).toBe("url");
    expect(ctx.detected).toBe(true);
    expect(ctx.updatedAt).toBe(FIXED_NOW());
  });

  it("the URL tier never supplies a timeframe — falls through to title even when the URL symbol was used", () => {
    const ctx = detectChartContext(env({ search: "?symbol=OANDA:XAUUSD", title: "XAUUSD, 15 — TradingView" }));
    expect(ctx.symbolSource).toBe("url");
    expect(ctx.timeframe).toBe("15m");
    expect(ctx.timeframeSource).toBe("title");
  });

  it("falls back to the title for the symbol when the URL has none", () => {
    const ctx = detectChartContext(env({ title: "OANDA:XAUUSD, 5 — TradingView" }));
    expect(ctx.symbol).toEqual({ raw: "OANDA:XAUUSD", display: "XAUUSD", exchange: "OANDA" });
    expect(ctx.symbolSource).toBe("title");
    expect(ctx.timeframe).toBe("5m");
    expect(ctx.timeframeSource).toBe("title");
  });

  it("falls back to the DOM for the symbol when neither URL nor title has one", () => {
    const ctx = detectChartContext(
      env({ title: "TradingView", dom: { '[data-name="legend-source-item"] [data-name="legend-source-title"]': "OANDA:XAUUSD" } }),
    );
    expect(ctx.symbol).toEqual({ raw: "OANDA:XAUUSD", display: "XAUUSD", exchange: "OANDA" });
    expect(ctx.symbolSource).toBe("dom");
  });

  it("falls back to a secondary DOM selector for the symbol when the primary one is absent", () => {
    const ctx = detectChartContext(env({ title: "TradingView", dom: { '[data-name="legend-series-item"]': "EURUSD" } }));
    expect(ctx.symbol).toEqual({ raw: "EURUSD", display: "EURUSD", exchange: null });
    expect(ctx.symbolSource).toBe("dom");
  });

  it("falls back to the DOM for the timeframe when the title has none", () => {
    const ctx = detectChartContext(
      env({ title: "OANDA:XAUUSD — TradingView", dom: { '[data-name="header-toolbar-intervals"] [data-value]': "60" } }),
    );
    expect(ctx.timeframe).toBe("1h");
    expect(ctx.timeframeSource).toBe("dom");
  });

  it("reports detected: false and both fields null when nothing matches anywhere", () => {
    const ctx = detectChartContext(env({ title: "Advanced charting platform" }));
    expect(ctx.symbol).toBeNull();
    expect(ctx.timeframe).toBeNull();
    expect(ctx.symbolSource).toBeNull();
    expect(ctx.timeframeSource).toBeNull();
    expect(ctx.detected).toBe(false);
  });

  it("reports detected: true when only the symbol is known", () => {
    const ctx = detectChartContext(env({ search: "?symbol=XAUUSD", title: "Advanced charting platform" }));
    expect(ctx.symbol).not.toBeNull();
    expect(ctx.timeframe).toBeNull();
    expect(ctx.detected).toBe(true);
  });

  it("reports detected: true when only the timeframe is known", () => {
    const ctx = detectChartContext(
      env({ title: "Advanced charting platform", dom: { '[data-name="header-toolbar-intervals"] [data-value]': "D" } }),
    );
    expect(ctx.symbol).toBeNull();
    expect(ctx.timeframe).toBe("1D");
    expect(ctx.detected).toBe(true);
  });

  it("degrades gracefully when a querySelector throws (e.g. an unsupported selector) instead of crashing detection", () => {
    const throwing: DetectionEnv = {
      location: { search: "" },
      document: {
        title: "",
        querySelector: () => {
          throw new Error("boom");
        },
      },
    };
    expect(() => detectChartContext(throwing)).not.toThrow();
    expect(detectChartContext(throwing).detected).toBe(false);
  });

  it("ignores an empty '?symbol=' query parameter rather than treating it as detected", () => {
    const ctx = detectChartContext(env({ search: "?symbol=", title: "Advanced charting platform" }));
    expect(ctx.symbol).toBeNull();
  });

  it("does not misfire the title regex on a generic, all-lowercase title", () => {
    const ctx = detectChartContext(env({ title: "advanced charting platform, free forever" }));
    expect(ctx.symbol).toBeNull();
  });
});
