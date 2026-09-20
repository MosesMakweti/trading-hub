import { describe, expect, it } from "vitest";

import type { TradingViewChartContext } from "@shared/chart-context";
import { EMPTY_DRAFT } from "@shared/draft";
import type { StateResponse } from "@shared/messages";
import type { StrategySummary } from "@shared/strategy";
import { toViewModel } from "./view";

// A StateResponse builder so each test only spells out what it cares about —
// chartContext/draft default to their "nothing yet" values, matching what a
// real StateResponse always has present (never absent) per @shared/messages.ts.
function state(overrides: Partial<StateResponse> & Pick<StateResponse, "connection" | "tradingViewDetected">): StateResponse {
  return { chartContext: null, draft: EMPTY_DRAFT, ...overrides };
}

const STRATEGIES: StrategySummary[] = [
  { id: "s1", name: "London Continuation", version: 1, status: "LIVE" },
  { id: "s2", name: "NY Open", version: 1, status: "LIVE" },
  { id: "s3", name: "Draft One", version: 1, status: "DRAFT" },
];

describe("toViewModel", () => {
  it("disconnected + TradingView not detected", () => {
    const vm = toViewModel(state({ connection: { status: "disconnected" }, tradingViewDetected: false }));
    expect(vm.section).toBe("disconnected");
    expect(vm.tvOn).toBe(false);
    expect(vm.tvLabel).toMatch(/open tradingview/i);
    expect(vm.showFooter).toBe(false);
    expect(vm.strategies).toEqual([]);
  });

  it("disconnected + TradingView detected", () => {
    const vm = toViewModel(state({ connection: { status: "disconnected" }, tradingViewDetected: true }));
    expect(vm.tvOn).toBe(true);
    expect(vm.tvLabel).toMatch(/tradingview detected/i);
  });

  it("connecting", () => {
    const vm = toViewModel(state({ connection: { status: "connecting" }, tradingViewDetected: true }));
    expect(vm.section).toBe("connecting");
  });

  it("error surfaces the message and stays in a clean (non-connected) state", () => {
    const vm = toViewModel(
      state({
        connection: { status: "error", message: "The Traditorium token is invalid or has been revoked." },
        tradingViewDetected: true,
      }),
    );
    expect(vm.section).toBe("error");
    expect(vm.errorMessage).toBe("The Traditorium token is invalid or has been revoked.");
    expect(vm.showFooter).toBe(false);
  });

  it("connected uses the real strategy list from the API, not a hard-coded count", () => {
    const vm = toViewModel(
      state({ connection: { status: "connected", user: { id: "u1", name: "Moses" }, strategies: STRATEGIES }, tradingViewDetected: true }),
    );
    expect(vm.section).toBe("connected");
    expect(vm.userName).toBe("Moses");
    expect(vm.strategyCountLabel).toBe("3 Strategies available");
    expect(vm.strategies).toEqual(STRATEGIES);
    expect(vm.showFooter).toBe(true);
  });

  it("connected with exactly one strategy uses singular phrasing", () => {
    const vm = toViewModel(
      state({ connection: { status: "connected", user: { id: "u1", name: "Moses" }, strategies: [STRATEGIES[0]!] }, tradingViewDetected: true }),
    );
    expect(vm.strategyCountLabel).toBe("1 Strategy available");
  });

  it("connected with zero strategies", () => {
    const vm = toViewModel(
      state({ connection: { status: "connected", user: { id: "u1", name: "Moses" }, strategies: [] }, tradingViewDetected: true }),
    );
    expect(vm.strategyCountLabel).toBe("0 Strategies available");
    expect(vm.strategies).toEqual([]);
  });

  it("falls back to a generic name when the API user has none", () => {
    const vm = toViewModel(
      state({ connection: { status: "connected", user: { id: "u1", name: null }, strategies: [] }, tradingViewDetected: true }),
    );
    expect(vm.userName).toBe("Trader");
  });
});

describe("toViewModel — chart context (Step 5)", () => {
  const FULL_CONTEXT: TradingViewChartContext = {
    symbol: { raw: "OANDA:XAUUSD", display: "OANDA:XAUUSD", exchange: "OANDA" },
    timeframe: "5m",
    detected: true,
    symbolSource: "url",
    timeframeSource: "title",
    updatedAt: 1000,
  };

  it("hides the chart card when TradingView itself isn't detected, regardless of connection status", () => {
    const vm = toViewModel(
      state({ connection: { status: "connected", user: { id: "u1", name: "Moses" }, strategies: [STRATEGIES[0]!] }, tradingViewDetected: false, chartContext: FULL_CONTEXT }),
    );
    expect(vm.chart.show).toBe(false);
    expect(vm.chart.symbolText).toBeNull();
    expect(vm.chart.timeframeText).toBeNull();
    expect(vm.chart.unavailableLabel).toBeNull();
  });

  it("shows the chart card even while disconnected from Traditorium, as long as TradingView is detected", () => {
    const vm = toViewModel(state({ connection: { status: "disconnected" }, tradingViewDetected: true, chartContext: FULL_CONTEXT }));
    expect(vm.chart.show).toBe(true);
    expect(vm.chart.symbolText).toBe("OANDA:XAUUSD");
    expect(vm.chart.timeframeText).toBe("5m");
  });

  it("reports 'Chart context unavailable' when the background has no context yet (null)", () => {
    const vm = toViewModel(state({ connection: { status: "disconnected" }, tradingViewDetected: true }));
    expect(vm.chart.show).toBe(true);
    expect(vm.chart.unavailableLabel).toBe("Chart context unavailable");
    expect(vm.chart.symbolText).toBeNull();
    expect(vm.chart.timeframeText).toBeNull();
  });

  it("reports 'Chart context unavailable' when detection ran but found neither symbol nor timeframe", () => {
    const vm = toViewModel(
      state({
        connection: { status: "disconnected" },
        tradingViewDetected: true,
        chartContext: { symbol: null, timeframe: null, detected: false, symbolSource: null, timeframeSource: null, updatedAt: 1 },
      }),
    );
    expect(vm.chart.unavailableLabel).toBe("Chart context unavailable");
  });

  it("falls back to 'Timeframe unavailable' when only the symbol was detected — never fabricates a timeframe", () => {
    const vm = toViewModel(
      state({
        connection: { status: "disconnected" },
        tradingViewDetected: true,
        chartContext: { symbol: { raw: "XAUUSD", display: "XAUUSD", exchange: null }, timeframe: null, detected: true, symbolSource: "url", timeframeSource: null, updatedAt: 1 },
      }),
    );
    expect(vm.chart.unavailableLabel).toBeNull();
    expect(vm.chart.symbolText).toBe("XAUUSD");
    expect(vm.chart.timeframeText).toBe("Timeframe unavailable");
  });

  it("falls back to 'Symbol unavailable' when only the timeframe was detected — never fabricates a symbol", () => {
    const vm = toViewModel(
      state({
        connection: { status: "disconnected" },
        tradingViewDetected: true,
        chartContext: { symbol: null, timeframe: "1h", detected: true, symbolSource: null, timeframeSource: "dom", updatedAt: 1 },
      }),
    );
    expect(vm.chart.unavailableLabel).toBeNull();
    expect(vm.chart.symbolText).toBe("Symbol unavailable");
    expect(vm.chart.timeframeText).toBe("1h");
  });
});
