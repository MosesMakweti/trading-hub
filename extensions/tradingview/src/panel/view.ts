/**
 * Traditorium TradingView Extension — Step 4. Pure view-model derivation —
 * `StateResponse` in, plain render instructions out, no DOM/chrome.* calls.
 * Kept separate from panel.ts so it's unit-testable without mocking the DOM
 * (see view.test.ts).
 */
import type { StateResponse } from "@shared/messages";
import type { StrategySummary } from "@shared/strategy";

export interface ChartViewModel {
  /** Step 5, §14 — the Chart card only appears once TradingView itself is
   *  detected; it doesn't matter whether Traditorium is connected yet. */
  show: boolean;
  /** Always a renderable string once `show` is true and `unavailableLabel`
   *  is null — falls back to "Symbol unavailable"/"Timeframe unavailable"
   *  for whichever half wasn't detected (§14: "Chart / XAUUSD / Timeframe
   *  unavailable"), never a fabricated value for the half that WAS. */
  symbolText: string | null;
  timeframeText: string | null;
  /** Set instead of the two fields above when NEITHER could be detected —
   *  never fabricated placeholder values (§14: "Do not fabricate values"). */
  unavailableLabel: string | null;
}

export interface ViewModel {
  tvLabel: string;
  tvOn: boolean;
  showConnRow: boolean;
  connLabel: string;
  connState: "on" | "error" | "off";
  section: "disconnected" | "connecting" | "error" | "connected";
  userName: string;
  strategyCountLabel: string;
  /** Step 6, §2 — non-empty only in the "connected" section; the strategy
   *  picker's own render logic (strategy-view.ts) reads this rather than
   *  reaching back into `StateResponse` itself. */
  strategies: StrategySummary[];
  errorMessage: string;
  showFooter: boolean;
  chart: ChartViewModel;
}

function toChartViewModel(state: StateResponse): ChartViewModel {
  if (!state.tradingViewDetected) {
    return { show: false, symbolText: null, timeframeText: null, unavailableLabel: null };
  }
  const ctx = state.chartContext;
  if (!ctx || !ctx.detected) {
    return { show: true, symbolText: null, timeframeText: null, unavailableLabel: "Chart context unavailable" };
  }
  return {
    show: true,
    symbolText: ctx.symbol?.display ?? "Symbol unavailable",
    timeframeText: ctx.timeframe ?? "Timeframe unavailable",
    unavailableLabel: null,
  };
}

export function toViewModel(state: StateResponse): ViewModel {
  const { connection, tradingViewDetected } = state;

  const base = {
    tvLabel: tradingViewDetected ? "TradingView detected" : "Open TradingView to use the trading companion.",
    tvOn: tradingViewDetected,
    chart: toChartViewModel(state),
  };

  switch (connection.status) {
    case "disconnected":
      return {
        ...base,
        showConnRow: false,
        connLabel: "",
        connState: "off",
        section: "disconnected",
        userName: "",
        strategyCountLabel: "",
        strategies: [],
        errorMessage: "",
        showFooter: false,
      };
    case "connecting":
      return {
        ...base,
        showConnRow: true,
        connLabel: "Connecting…",
        connState: "off",
        section: "connecting",
        userName: "",
        strategyCountLabel: "",
        strategies: [],
        errorMessage: "",
        showFooter: false,
      };
    case "error":
      return {
        ...base,
        showConnRow: false,
        connLabel: "",
        connState: "off",
        section: "error",
        userName: "",
        strategyCountLabel: "",
        strategies: [],
        errorMessage: connection.message,
        showFooter: false,
      };
    case "connected": {
      const count = connection.strategies.length;
      return {
        ...base,
        showConnRow: true,
        connLabel: "Connected to Traditorium",
        connState: "on",
        section: "connected",
        userName: connection.user.name ?? "Trader",
        strategyCountLabel: `${count} ${count === 1 ? "Strategy" : "Strategies"} available`,
        strategies: connection.strategies,
        errorMessage: "",
        showFooter: true,
      };
    }
  }
}
