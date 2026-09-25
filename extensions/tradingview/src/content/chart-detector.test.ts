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

// Release-gate finding — these are the ACTUAL live formats TradingView's
// interactive /chart/ page was confirmed to produce (see chart-detector.ts's
// module doc comment for the full investigation). Earlier fixtures assumed a
// "SYMBOL, INTERVAL — TradingView" title and a working
// `[data-name="legend-source-item"]`/`[data-name="header-toolbar-intervals"]`
// DOM shape — neither was ever true on the live interactive app.
const LIVE_TITLE_XAUUSD = "XAUUSD 4,272.955 ▼ −0.02% BANKS";
const LIVE_TITLE_EURUSD = "EURUSD 1.13766 ▼ −0.03% BANKS";
const LIVE_TITLE_ES1 = "ES1! 7,755.25 ▼ −0.15% BANKS";

describe("detectChartContext", () => {
  describe("symbol", () => {
    it("prefers the URL symbol over title/DOM, and reports its source as 'url'", () => {
      const ctx = detectChartContext(env({ search: "?symbol=OANDA:XAUUSD", title: LIVE_TITLE_XAUUSD }), FIXED_NOW);
      expect(ctx.symbol).toEqual({ raw: "OANDA:XAUUSD", display: "XAUUSD", exchange: "OANDA" });
      expect(ctx.symbolSource).toBe("url");
      expect(ctx.detected).toBe(true);
      expect(ctx.updatedAt).toBe(FIXED_NOW());
    });

    it("ignores an empty '?symbol=' query parameter rather than treating it as detected", () => {
      const ctx = detectChartContext(env({ search: "?symbol=", title: "Advanced charting platform" }));
      expect(ctx.symbol).toBeNull();
    });

    it("falls back to the title for a bare-URL saved-layout page (the common real case — no ?symbol= present)", () => {
      const ctx = detectChartContext(env({ search: "", title: LIVE_TITLE_XAUUSD }));
      expect(ctx.symbol).toEqual({ raw: "XAUUSD", display: "XAUUSD", exchange: null });
      expect(ctx.symbolSource).toBe("title");
    });

    it("parses the live title format for EURUSD (no thousands separator in the price)", () => {
      const ctx = detectChartContext(env({ title: LIVE_TITLE_EURUSD }));
      expect(ctx.symbol).toEqual({ raw: "EURUSD", display: "EURUSD", exchange: null });
    });

    it("preserves a futures continuous-contract suffix like ES1! from the live title", () => {
      const ctx = detectChartContext(env({ title: LIVE_TITLE_ES1 }));
      expect(ctx.symbol).toEqual({ raw: "ES1!", display: "ES1!", exchange: null });
    });

    it("does not let the title regex swallow the live price into the symbol match", () => {
      // A naive "match up to the next separator" regex could have captured
      // "XAUUSD 4" or similar from "XAUUSD 4,272.955 ..." — the real title
      // has NO comma/dash immediately after the symbol, only a space before
      // the price. This pins the terminator to whitespace/end, not a comma.
      const ctx = detectChartContext(env({ title: LIVE_TITLE_XAUUSD }));
      expect(ctx.symbol?.raw).toBe("XAUUSD");
    });

    it("does not misfire the title regex on a generic, all-lowercase title", () => {
      const ctx = detectChartContext(env({ title: "advanced charting platform, free forever" }));
      expect(ctx.symbol).toBeNull();
    });

    it("falls back to the DOM 'Change symbol' button as a last resort when title has no match", () => {
      const ctx = detectChartContext(env({ title: "TradingView", dom: { '[aria-label="Change symbol"]': "OANDA:XAUUSD" } }));
      expect(ctx.symbol).toEqual({ raw: "OANDA:XAUUSD", display: "XAUUSD", exchange: "OANDA" });
      expect(ctx.symbolSource).toBe("dom");
    });

    it("degrades gracefully (never throws) when the DOM tier returns a human-readable description instead of a ticker", () => {
      // Live-observed: the same button can render "Gold Spot / U.S. Dollar"
      // instead of "OANDA:XAUUSD" depending on a legend display setting —
      // this must still report something detected, not crash or fabricate
      // a fake ticker.
      const ctx = detectChartContext(env({ title: "TradingView", dom: { '[aria-label="Change symbol"]': "Gold Spot / U.S. Dollar" } }));
      expect(ctx.symbol).toEqual({ raw: "Gold Spot / U.S. Dollar", display: "Gold Spot / U.S. Dollar", exchange: null });
      expect(ctx.symbolSource).toBe("dom");
    });
  });

  describe("timeframe", () => {
    it("reads the raw resolution string from the DOM 'Change interval' button (the only tier)", () => {
      const ctx = detectChartContext(env({ title: LIVE_TITLE_XAUUSD, dom: { '[aria-label="Change interval"]': "5" } }));
      expect(ctx.timeframe).toBe("5m");
      expect(ctx.timeframeSource).toBe("dom");
    });

    it("normalizes each canonical timeframe TradingView's toolbar can show", () => {
      const cases: Array<[string, string]> = [
        ["1", "1m"],
        ["5", "5m"],
        ["15", "15m"],
        ["60", "1h"],
        ["240", "4h"],
        ["D", "1D"],
        ["W", "1W"],
      ];
      for (const [raw, expected] of cases) {
        const ctx = detectChartContext(env({ dom: { '[aria-label="Change interval"]': raw } }));
        expect(ctx.timeframe, `raw "${raw}"`).toBe(expected);
      }
    });

    it("does NOT fabricate a timeframe from a fragment of the live price in the title (the actual bug that caused 'Chart context unavailable')", () => {
      // "XAUUSD 4,272.955 ..." — an earlier version of this module scanned
      // the title for a ",<digits>" pattern and would match the "," before
      // "272" inside the price itself, producing a fabricated "272m". There
      // is no title-based timeframe tier anymore, so this must stay null
      // unless the DOM tier supplies a real value.
      const ctx = detectChartContext(env({ title: LIVE_TITLE_XAUUSD }));
      expect(ctx.timeframe).toBeNull();
      expect(ctx.timeframeSource).toBeNull();
    });

    it("does not infer a timeframe when the DOM tier has nothing", () => {
      const ctx = detectChartContext(env({ title: LIVE_TITLE_XAUUSD }));
      expect(ctx.timeframe).toBeNull();
    });
  });

  describe("detected / overall", () => {
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
      const ctx = detectChartContext(env({ title: "Advanced charting platform", dom: { '[aria-label="Change interval"]': "D" } }));
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
  });
});
